import { createHmac } from 'node:crypto';

import {
  logEvent,
  MAX_WEBHOOK_BODY_BYTES,
  parseJsonBody,
  requestHeaderExact,
  requestQueryExact,
  safeEqualHex,
  serviceClient,
  type ApiRequest,
  type ApiResponse,
} from '../../server/commerce/commerce.js';
import { createSupabasePaymentRepository, processMercadoPagoPayment, type MercadoPagoPayment } from '../../server/commerce/paymentProcessing.js';

type WebhookBody = { type?: unknown; data?: { id?: unknown } };
const RESOURCE_ID = /^[A-Za-z0-9_-]{1,256}$/;

type WebhookResource =
  | { resourceId: string; rawResourceId: string; source: 'data.id' | 'id'; reason: null }
  | { resourceId: null; source: null; reason: 'resource_id_missing' | 'resource_id_ambiguous' | 'resource_id_invalid' };

type SignatureParts = { timestamp: string | null; digest: string | null; reason: 'ok' | 'signature_malformed' | 'signature_timestamp_missing' | 'signature_digest_missing' };
type CanonicalVariant = 'official_data_id' | 'data_id_without_final_semicolon' | 'data_id_original_case' | 'id_alias_normalized' | 'id_alias_without_final_semicolon' | 'id_alias_original_case' | 'none';
type SecretDiagnostics = { secretLength: number; secretHasLeadingWhitespace: boolean; secretHasTrailingWhitespace: boolean; secretHasLineBreak: boolean };
type SignatureDiagnostics = SecretDiagnostics & { canonicalVariantMatch: CanonicalVariant };

export default async function handler(request: ApiRequest, response: ApiResponse) {
  if (request.method !== 'POST') {
    response.setHeader?.('Allow', 'POST');
    return response.status(405).json({ error: 'Metodo no permitido.' });
  }
  const body = parseJsonBody(request.body, MAX_WEBHOOK_BODY_BYTES) as WebhookBody | null;
  // Mercado Pago signs the query parameter, never a re-serialized body.
  const resource = webhookResource(request);
  const signatureHeader = requestHeaderExact(request, 'x-signature');
  const requestIdHeader = requestHeaderExact(request, 'x-request-id');
  const signature = signatureHeader.value;
  const requestId = requestIdHeader.value;
  const secret = process.env.MERCADOPAGO_WEBHOOK_SECRET;
  const signatureParts = signature ? parseSignature(signature) : null;
  const signatureDiagnostics = signature && requestId && secret && signatureParts?.reason === 'ok' && resource.resourceId
    ? diagnoseSignature(signature, requestId, resource, secret)
    : { ...secretDiagnostics(secret), canonicalVariantMatch: 'none' as const, officialValid: false };
  if (!resource.resourceId || !signature || !requestId || !secret || signatureHeader.ambiguous || requestIdHeader.ambiguous || signatureParts?.reason !== 'ok') {
    logWebhookRejection('unsigned_or_malformed', resource, body, {
      hasSignature: signatureHeader.present,
      hasRequestId: requestIdHeader.present,
      hasTimestamp: Boolean(signatureParts?.timestamp),
      hasDigest: Boolean(signatureParts?.digest),
    }, signatureDiagnostics);
    return response.status(401).json({ error: 'No autorizado.' });
  }
  // Only data.id is part of Mercado Pago's documented signed-webhook contract.
  // The id alias is retained strictly for diagnostics and always fails closed.
  if (resource.source !== 'data.id' || !signatureDiagnostics.officialValid) {
    logWebhookRejection(resource.source === 'id' ? 'legacy_notification_rejected' : 'signature_invalid', resource, body, {
      hasSignature: true, hasRequestId: true, hasTimestamp: true, hasDigest: true,
    }, signatureDiagnostics);
    return response.status(401).json({ error: 'No autorizado.' });
  }
  if (body?.type !== 'payment') return response.status(200).json({ received: true });

  const supabase = serviceClient();
  const accessToken = process.env.MERCADOPAGO_ACCESS_TOKEN;
  if (!supabase || !accessToken) {
    logEvent('webhook_not_configured');
    return response.status(503).json({ error: 'No disponible.' });
  }

  let payment: MercadoPagoPayment;
  try {
    const providerResponse = await fetch(`https://api.mercadopago.com/v1/payments/${encodeURIComponent(resource.resourceId)}`, {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
    });
    if (!providerResponse.ok) {
      logEvent('webhook_payment_lookup_failed', { status: providerResponse.status });
      return response.status(502).json({ error: 'No disponible.' });
    }
    payment = await providerResponse.json() as MercadoPagoPayment;
  } catch {
    logEvent('webhook_payment_lookup_error');
    return response.status(502).json({ error: 'No disponible.' });
  }

  const result = await processMercadoPagoPayment(createSupabasePaymentRepository(supabase), payment, {
    requestId,
  });
  if (result.kind === 'unavailable') {
    logEvent('webhook_payment_processing_unavailable');
    return response.status(503).json({ error: 'No disponible.' });
  }
  if (result.kind === 'rejected') {
    logEvent('webhook_payment_rejected', { reason: result.reason });
    return response.status(200).json({ received: true });
  }
  if (result.kind === 'duplicate') return response.status(200).json({ received: true });
  logEvent('webhook_processed', { paymentStatus: result.status });
  return response.status(200).json({ received: true });
}

export function isValidSignature(signature: string, requestId: string, dataId: string, secret: string) {
  const resource: WebhookResource = {
    rawResourceId: dataId,
    resourceId: normalizeWebhookResourceId(dataId),
    source: 'data.id',
    reason: null,
  };
  return diagnoseSignature(signature, requestId, resource, secret).officialValid;
}

export function webhookResource(request: ApiRequest): WebhookResource {
  const dataId = requestQueryExact(request, 'data.id');
  const id = requestQueryExact(request, 'id');
  if (dataId.ambiguous || id.ambiguous || (dataId.present && id.present)) return { resourceId: null, source: null, reason: 'resource_id_ambiguous' };
  const selected = dataId.value ? { value: dataId.value, source: 'data.id' as const } : id.value ? { value: id.value, source: 'id' as const } : null;
  if (!selected) return { resourceId: null, source: null, reason: 'resource_id_missing' };
  const resourceId = normalizeWebhookResourceId(selected.value);
  if (!RESOURCE_ID.test(resourceId)) return { resourceId: null, source: null, reason: 'resource_id_invalid' };
  return { resourceId, rawResourceId: selected.value, source: selected.source, reason: null };
}

export function normalizeWebhookResourceId(value: string) {
  // Mercado Pago documents lower-casing alphanumeric data.id before signing.
  return value.toLowerCase();
}

export function diagnoseSignature(signature: string, requestId: string, resource: Extract<WebhookResource, { reason: null }>, secret: string): SignatureDiagnostics & { officialValid: boolean } {
  const parts = parseSignature(signature);
  const base = secretDiagnostics(secret);
  if (parts.reason !== 'ok' || !parts.timestamp || !parts.digest) return { ...base, canonicalVariantMatch: 'none', officialValid: false };
  const digest = parts.digest;

  const candidates: Array<{ name: Exclude<CanonicalVariant, 'none'>; manifest: string; official: boolean }> = [
    {
      name: resource.source === 'data.id' ? 'official_data_id' : 'id_alias_normalized',
      manifest: signedManifest(resource.resourceId, requestId, parts.timestamp, true),
      official: resource.source === 'data.id',
    },
    {
      name: resource.source === 'data.id' ? 'data_id_without_final_semicolon' : 'id_alias_without_final_semicolon',
      manifest: signedManifest(resource.resourceId, requestId, parts.timestamp, false),
      official: false,
    },
    {
      name: resource.source === 'data.id' ? 'data_id_original_case' : 'id_alias_original_case',
      manifest: signedManifest(resource.rawResourceId, requestId, parts.timestamp, true),
      official: false,
    },
  ];
  const match = candidates.find((candidate) => safeEqualHex(digest, createHmac('sha256', secret).update(candidate.manifest, 'utf8').digest('hex')));
  return { ...base, canonicalVariantMatch: match?.name ?? 'none', officialValid: Boolean(match?.official) };
}

function signedManifest(resourceId: string, requestId: string, timestamp: string, finalSemicolon: boolean) {
  return `id:${resourceId};request-id:${requestId};ts:${timestamp}${finalSemicolon ? ';' : ''}`;
}

function secretDiagnostics(secret: string | undefined): SecretDiagnostics {
  const value = secret ?? '';
  return {
    secretLength: value.length,
    secretHasLeadingWhitespace: /^\s/.test(value),
    secretHasTrailingWhitespace: /\s$/.test(value),
    secretHasLineBreak: /[\r\n]/.test(value),
  };
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
  if (!digest || !/^[a-f0-9]{64}$/.test(digest)) return { timestamp, digest: null, reason: 'signature_digest_missing' };
  return { timestamp, digest, reason: 'ok' };
}

function logWebhookRejection(
  reason: string,
  resource: WebhookResource,
  body: WebhookBody | null,
  diagnostics: { hasSignature: boolean; hasRequestId: boolean; hasTimestamp: boolean; hasDigest: boolean },
  signatureDiagnostics?: SignatureDiagnostics,
) {
  const eventType = typeof body?.type === 'string' && body.type.length <= 40 ? body.type : null;
  logEvent('webhook_rejected', {
    reason: resource.reason ?? reason,
    resourceSource: resource.source ?? undefined,
    resourceId: resource.resourceId ?? undefined,
    eventType: eventType ?? undefined,
    ...diagnostics,
    ...(signatureDiagnostics ? {
      secretLength: signatureDiagnostics.secretLength,
      secretHasLeadingWhitespace: signatureDiagnostics.secretHasLeadingWhitespace,
      secretHasTrailingWhitespace: signatureDiagnostics.secretHasTrailingWhitespace,
      secretHasLineBreak: signatureDiagnostics.secretHasLineBreak,
      canonicalVariantMatch: signatureDiagnostics.canonicalVariantMatch,
    } : {}),
  });
}
