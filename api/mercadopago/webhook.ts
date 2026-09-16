import { createHmac } from 'node:crypto';

import {
  hash,
  header,
  logEvent,
  MAX_WEBHOOK_BODY_BYTES,
  parseJsonBody,
  query,
  safeEqualHex,
  serviceClient,
  type ApiRequest,
  type ApiResponse,
} from '../../server/commerce/commerce.js';

type WebhookBody = { type?: unknown; data?: { id?: unknown } };
type Payment = { id?: string | number; status?: string; transaction_amount?: number | string; currency_id?: string; external_reference?: string; preference_id?: string };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export default async function handler(request: ApiRequest, response: ApiResponse) {
  if (request.method !== 'POST') {
    response.setHeader?.('Allow', 'POST');
    return response.status(405).json({ error: 'Metodo no permitido.' });
  }
  const body = parseJsonBody(request.body, MAX_WEBHOOK_BODY_BYTES) as WebhookBody | null;
  // Mercado Pago signs the query parameter data.id, not a re-serialized body.
  const paymentId = query(request, 'data.id');
  const signature = header(request, 'x-signature');
  const requestId = header(request, 'x-request-id');
  const secret = process.env.MERCADOPAGO_WEBHOOK_SECRET;
  if (!paymentId || !signature || !requestId || !secret) {
    logEvent('webhook_signature_missing');
    return response.status(401).json({ error: 'No autorizado.' });
  }
  if (!isValidSignature(signature, requestId, paymentId, secret)) {
    logEvent('webhook_signature_invalid');
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
    const providerResponse = await fetch(`https://api.mercadopago.com/v1/payments/${encodeURIComponent(paymentId)}`, {
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
  const payloadHash = hash(`${paymentId}:${status}:${payment.external_reference}:${payment.preference_id ?? ''}:${amount}:${payment.currency_id}`);
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
  const fields = new Map(signature.split(',').map((part) => {
    const [key, ...rest] = part.trim().split('=');
    return [key, rest.join('=')];
  }));
  const timestamp = fields.get('ts');
  const received = fields.get('v1');
  if (!timestamp || !received || !/^\d+$/.test(timestamp) || !/^[a-f0-9]{64}$/i.test(received)) return false;
  const manifest = `id:${dataId};request-id:${requestId};ts:${timestamp};`;
  const expected = createHmac('sha256', secret).update(manifest).digest('hex');
  return safeEqualHex(received.toLowerCase(), expected);
}
