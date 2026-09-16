import { createHmac } from 'node:crypto';

import {
  hash,
  header,
  logEvent,
  MAX_WEBHOOK_BODY_BYTES,
  parseJsonBody,
  requestHeader,
  requestQuery,
  safeEqualHex,
  serviceClient,
  type ApiRequest,
  type ApiResponse,
} from '../../server/commerce/commerce.js';

type WebhookBody = { type?: unknown; data?: { id?: unknown } };
type Payment = { id?: string | number; status?: string; transaction_amount?: number | string; currency_id?: string; external_reference?: string; preference_id?: string };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const RESOURCE_ID = /^[A-Za-z0-9_-]{1,256}$/;

type WebhookResource =
  | { resourceId: string; source: 'data.id' | 'id'; reason: null }
  | { resourceId: null; source: null; reason: 'resource_id_missing' | 'resource_id_ambiguous' | 'resource_id_invalid' };

type SignatureParts = { timestamp: string | null; digest: string | null; reason: 'ok' | 'signature_malformed' | 'signature_timestamp_missing' | 'signature_digest_missing' };

export default async function handler(request: ApiRequest, response: ApiResponse) {
  if (request.method !== 'POST') {
    response.setHeader?.('Allow', 'POST');
    return response.status(405).json({ error: 'Metodo no permitido.' });
  }
  const body = parseJsonBody(request.body, MAX_WEBHOOK_BODY_BYTES) as WebhookBody | null;
  // Mercado Pago signs the query parameter, never a re-serialized body.
  const resource = webhookResource(request);
  const signatureHeader = requestHeader(request, 'x-signature');
  const requestIdHeader = requestHeader(request, 'x-request-id');
  const signature = signatureHeader.value;
  const requestId = requestIdHeader.value;
  const secret = process.env.MERCADOPAGO_WEBHOOK_SECRET;
  const signatureParts = signature ? parseSignature(signature) : null;
  if (!resource.resourceId || !signature || !requestId || !secret || signatureHeader.ambiguous || requestIdHeader.ambiguous || signatureParts?.reason !== 'ok') {
    logWebhookRejection('unsigned_or_malformed', resource, body, {
      hasSignature: signatureHeader.present,
      hasRequestId: requestIdHeader.present,
      hasTimestamp: Boolean(signatureParts?.timestamp),
      hasDigest: Boolean(signatureParts?.digest),
    });
    return response.status(401).json({ error: 'No autorizado.' });
  }
  if (!isValidSignature(signature, requestId, resource.resourceId, secret)) {
    logWebhookRejection('signature_invalid', resource, body, {
      hasSignature: true, hasRequestId: true, hasTimestamp: true, hasDigest: true,
    });
    return response.status(401).json({ error: 'No autorizado.' });
  }
  if (body?.type !== 'payment') return response.status(200).json({ received: true });

  const supabase = serviceClient();
  const accessToken = process.env.MERCADOPAGO_ACCESS_TOKEN;
  if (!supabase || !accessToken) {
    logEvent('webhook_not_configured');
    return response.status(503).json({ error: 'No disponible.' });
  }

  let payment: Payment;
  try {
    const providerResponse = await fetch(`https://api.mercadopago.com/v1/payments/${encodeURIComponent(resource.resourceId)}`, {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
    });
    if (!providerResponse.ok) {
      logEvent('webhook_payment_lookup_failed', { status: providerResponse.status });
      return response.status(502).json({ error: 'No disponible.' });
    }
    payment = await providerResponse.json() as Payment;
  } catch {
    logEvent('webhook_payment_lookup_error');
    return response.status(502).json({ error: 'No disponible.' });
  }

  const orderId = typeof payment.external_reference === 'string' ? payment.external_reference : '';
  const preferenceId = typeof payment.preference_id === 'string' ? payment.preference_id : '';
  const amount = Number(payment.transaction_amount);
  const providerPaymentId = String(payment.id ?? '');
  const status = typeof payment.status === 'string' ? payment.status : '';
  if (!UUID.test(orderId) || !providerPaymentId || !status || !Number.isFinite(amount) || !payment.currency_id) {
    logEvent('webhook_payment_shape_invalid');
    return response.status(200).json({ received: true });
  }

  const dedupeKey = hash(`${requestId}:${providerPaymentId}:${status}`);
  const payloadHash = hash(`${resource.resourceId}:${status}:${payment.external_reference}:${payment.preference_id ?? ''}:${amount}:${payment.currency_id}`);
  const { data: eventRows, error: eventError } = await supabase.rpc('record_mercadopago_payment_event', {
    p_dedupe_key: dedupeKey, p_request_id: requestId, p_provider_event_id: null,
    p_provider_payment_id: providerPaymentId, p_order_id: orderId, p_external_reference: orderId,
    p_payload_hash: payloadHash, p_provider_status: status,
  });
  if (eventError || !Array.isArray(eventRows) || eventRows.length !== 1) {
    logEvent('webhook_event_record_failed');
    return response.status(503).json({ error: 'No disponible.' });
  }
  if (eventRows[0].is_duplicate) return response.status(200).json({ received: true });

  const { error: transitionError } = await supabase.rpc('apply_mercadopago_payment_transition', {
    p_event_id: eventRows[0].event_id, p_order_id: orderId, p_payment_id: providerPaymentId,
    p_payment_status: status, p_amount: amount, p_currency: payment.currency_id,
    p_external_reference: orderId, p_preference_id: preferenceId,
  });
  if (transitionError) {
    logEvent('webhook_transition_failed');
    return response.status(503).json({ error: 'No disponible.' });
  }
  logEvent('webhook_processed', { paymentStatus: status });
  return response.status(200).json({ received: true });
}

export function isValidSignature(signature: string, requestId: string, dataId: string, secret: string) {
  const parts = parseSignature(signature);
  if (parts.reason !== 'ok' || !parts.timestamp || !parts.digest) return false;
  const manifest = `id:${normalizeWebhookResourceId(dataId)};request-id:${requestId};ts:${parts.timestamp};`;
  const expected = createHmac('sha256', secret).update(manifest).digest('hex');
  return safeEqualHex(parts.digest.toLowerCase(), expected);
}

export function webhookResource(request: ApiRequest): WebhookResource {
  const dataId = requestQuery(request, 'data.id');
  const id = requestQuery(request, 'id');
  if (dataId.ambiguous || id.ambiguous || (dataId.present && id.present)) return { resourceId: null, source: null, reason: 'resource_id_ambiguous' };
  const selected = dataId.value ? { value: dataId.value, source: 'data.id' as const } : id.value ? { value: id.value, source: 'id' as const } : null;
  if (!selected) return { resourceId: null, source: null, reason: 'resource_id_missing' };
  const resourceId = normalizeWebhookResourceId(selected.value);
  if (!RESOURCE_ID.test(resourceId)) return { resourceId: null, source: null, reason: 'resource_id_invalid' };
  return { resourceId, source: selected.source, reason: null };
}

export function normalizeWebhookResourceId(value: string) {
  // Mercado Pago documents lower-casing alphanumeric data.id before signing.
  return value.trim().toLowerCase();
}

export function parseSignature(signature: string): SignatureParts {
  const fields = new Map<string, string>();
  for (const part of signature.split(',')) {
    const index = part.indexOf('=');
    if (index < 1) return { timestamp: null, digest: null, reason: 'signature_malformed' };
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (!key || !value || fields.has(key)) return { timestamp: null, digest: null, reason: 'signature_malformed' };
    fields.set(key, value);
  }
  const timestamp = fields.get('ts') ?? null;
  const digest = fields.get('v1') ?? null;
  if (!timestamp || !/^\d+$/.test(timestamp)) return { timestamp: null, digest, reason: 'signature_timestamp_missing' };
  if (!digest || !/^[a-f0-9]{64}$/i.test(digest)) return { timestamp, digest: null, reason: 'signature_digest_missing' };
  return { timestamp, digest, reason: 'ok' };
}

function logWebhookRejection(
  reason: string,
  resource: WebhookResource,
  body: WebhookBody | null,
  diagnostics: { hasSignature: boolean; hasRequestId: boolean; hasTimestamp: boolean; hasDigest: boolean },
) {
  const eventType = typeof body?.type === 'string' && body.type.length <= 40 ? body.type : null;
  logEvent('webhook_rejected', {
    reason: resource.reason ?? reason,
    resourceSource: resource.source ?? undefined,
    resourceId: resource.resourceId ?? undefined,
    eventType: eventType ?? undefined,
    ...diagnostics,
  });
}
