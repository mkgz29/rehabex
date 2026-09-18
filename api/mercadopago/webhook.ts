import { InvalidWebhookSignatureError, WebhookSignatureValidator } from 'mercadopago';

import {
  logEvent,
  MAX_WEBHOOK_BODY_BYTES,
  parseJsonBody,
  requestHeaderExact,
  requestQueryExact,
  serviceClient,
  type ApiRequest,
  type ApiResponse,
} from '../../server/commerce/commerce.js';
import { confirmMercadoPagoPayment } from '../../server/commerce/paymentConfirmation.js';
import { fetchMercadoPagoPayment } from '../../server/commerce/mercadoPagoPayment.js';

type WebhookBody = { type?: unknown; data?: { id?: unknown } };
const RESOURCE_ID = /^[A-Za-z0-9_-]{1,256}$/;

export type WebhookResource = {
  resourceId: string | null;
  source: 'data.id' | 'id' | null;
  reason: null | 'resource_id_missing' | 'resource_id_ambiguous' | 'resource_id_invalid';
};

type RejectionPresence = { hasSignature: boolean; hasRequestId: boolean };

export default async function handler(request: ApiRequest, response: ApiResponse) {
  if (request.method !== 'POST') {
    response.setHeader?.('Allow', 'POST');
    return response.status(405).json({ error: 'Metodo no permitido.' });
  }

  const body = parseJsonBody(request.body, MAX_WEBHOOK_BODY_BYTES) as WebhookBody | null;
  const resource = webhookResource(request);
  const signature = requestHeaderExact(request, 'x-signature');
  const requestId = requestHeaderExact(request, 'x-request-id');
  const presence: RejectionPresence = { hasSignature: signature.present, hasRequestId: requestId.present };
  const secret = process.env.MERCADOPAGO_WEBHOOK_SECRET;

  // Legacy IPN (`id` + `topic`) is a separate channel that Mercado Pago documents as
  // non-validatable with the panel secret, so it is refused before any signature work.
  if (resource.source === 'id') {
    logWebhookRejection('legacy_notification_rejected', resource, body, presence);
    return response.status(401).json({ error: 'No autorizado.' });
  }

  // Ambiguous or duplicated headers/query values resolve to null and fail closed here.
  if (!resource.resourceId || !signature.value || !requestId.value || !secret) {
    logWebhookRejection('unsigned_or_malformed', resource, body, presence);
    return response.status(401).json({ error: 'No autorizado.' });
  }

  // Official contract: the SDK validator receives `x-signature`, `x-request-id` and
  // `data.id` exactly as received, plus the panel secret. No manifest is rebuilt here.
  try {
    WebhookSignatureValidator.validate({
      xSignature: signature.value,
      xRequestId: requestId.value,
      dataId: resource.resourceId,
      secret,
    });
  } catch (error) {
    logWebhookRejection('signature_invalid', resource, body, presence, signatureFailureReason(error));
    return response.status(401).json({ error: 'No autorizado.' });
  }

  if (body?.type !== 'payment') return response.status(200).json({ received: true });

  const supabase = serviceClient();
  const accessToken = process.env.MERCADOPAGO_ACCESS_TOKEN;
  if (!supabase || !accessToken) {
    logEvent('webhook_not_configured');
    return response.status(503).json({ error: 'No disponible.' });
  }

  const provider = await fetchMercadoPagoPayment(resource.resourceId, accessToken);
  if (provider.kind !== 'ok') {
    // resourceId is the data.id the notification carried: an opaque Mercado Pago
    // payment reference. Never headers, signature material, credentials, body or PII.
    if (provider.httpStatus) logEvent('webhook_payment_lookup_failed', { resourceId: resource.resourceId, providerHttpStatus: provider.httpStatus });
    else logEvent('webhook_payment_lookup_error', { resourceId: resource.resourceId });
    return response.status(502).json({ error: 'No disponible.' });
  }

  // Same atomic RPC as the recovery and admin channels, so one payment can be
  // delivered through any of them and still transition the order exactly once.
  const { result, binding } = await confirmMercadoPagoPayment(supabase, provider.payment, {
    requestId: requestId.value,
    binding: provider.preferenceBinding,
  });
  if (result.kind === 'unavailable') {
    logEvent('webhook_payment_processing_unavailable');
    return response.status(503).json({ error: 'No disponible.' });
  }
  if (result.kind === 'rejected') {
    logEvent('webhook_payment_rejected', { resourceId: resource.resourceId, reason: result.reason, preferenceBinding: binding });
    return response.status(200).json({ received: true });
  }
  if (result.kind === 'duplicate') return response.status(200).json({ received: true });
  logEvent('webhook_processed', { resourceId: resource.resourceId, paymentStatus: result.status, preferenceBinding: binding });
  return response.status(200).json({ received: true });
}

export function webhookResource(request: ApiRequest): WebhookResource {
  const dataId = requestQueryExact(request, 'data.id');
  const id = requestQueryExact(request, 'id');
  if (dataId.ambiguous || id.ambiguous || (dataId.present && id.present)) return { resourceId: null, source: null, reason: 'resource_id_ambiguous' };
  const selected = dataId.value ? { value: dataId.value, source: 'data.id' as const } : id.value ? { value: id.value, source: 'id' as const } : null;
  if (!selected) return { resourceId: null, source: null, reason: 'resource_id_missing' };
  // The value is forwarded to the official validator exactly as received; the SDK
  // owns the documented normalization used to rebuild the signed manifest.
  if (!RESOURCE_ID.test(selected.value)) return { resourceId: null, source: selected.source, reason: 'resource_id_invalid' };
  return { resourceId: selected.value, source: selected.source, reason: null };
}

/** Sanitized SDK enum (never the signature, the secret or any payload). */
export function signatureFailureReason(error: unknown) {
  return error instanceof InvalidWebhookSignatureError ? String(error.reason) : 'signature_validation_error';
}

function logWebhookRejection(
  reason: string,
  resource: WebhookResource,
  body: WebhookBody | null,
  presence: RejectionPresence,
  failureReason?: string,
) {
  const eventType = typeof body?.type === 'string' && body.type.length <= 40 ? body.type : null;
  logEvent('webhook_rejected', {
    reason: resource.reason ?? reason,
    resourceSource: resource.source ?? undefined,
    resourceId: resource.resourceId ?? undefined,
    eventType: eventType ?? undefined,
    ...presence,
    signatureFailureReason: failureReason,
  });
}
