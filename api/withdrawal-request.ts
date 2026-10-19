import { randomUUID } from 'node:crypto';

import {
  applyCors,
  isJsonContentType,
  keyedHash,
  logEvent,
  readJsonBody,
  serviceClient,
  setRetryAfter,
  trustedClientIp,
  type ApiRequest,
  type ApiResponse,
} from '../server/commerce/commerce.js';
import { mapPublicSupportRpcError } from '../server/support/publicErrors.js';
import { parsePublicWithdrawalPayload } from '../server/withdrawal/publicValidators.js';

export const config = { api: { bodyParser: false } };

const MAX_BODY_BYTES = 16 * 1024;
const REQUEST_CODE_PATTERN = /^ARR-\d{8}-[A-F0-9]{8}$/;

type WithdrawalDependencies = { serviceClient: typeof serviceClient };
const defaultDependencies: WithdrawalDependencies = { serviceClient };

function syntheticRequestCode() {
  const date = new Date().toISOString().slice(0, 10).replaceAll('-', '');
  return `ARR-${date}-${randomUUID().replaceAll('-', '').slice(0, 8).toUpperCase()}`;
}

export default async function handler(request: ApiRequest, response: ApiResponse, deps: WithdrawalDependencies = defaultDependencies) {
  if (!applyCors(request, response)) return response.status(403).json({ error: 'Origen no permitido.' });
  if (request.method === 'OPTIONS') return response.status(204).end?.();
  if (request.method !== 'POST') {
    response.setHeader?.('Allow', 'POST, OPTIONS');
    return response.status(405).json({ error: 'Metodo no permitido.' });
  }
  if (!isJsonContentType(request)) return response.status(415).json({ error: 'Content-Type no permitido.' });

  const body = await readJsonBody(request, MAX_BODY_BYTES);
  if (body.ok === false) {
    return body.reason === 'invalid'
      ? response.status(400).json({ error: 'Solicitud invalida.' })
      : response.status(413).json({ error: 'Solicitud demasiado grande.' });
  }

  const payload = parsePublicWithdrawalPayload(body.value);
  if (!payload.ok) return response.status(400).json({ error: 'Solicitud invalida.' });

  // Keep bot detection indistinguishable without storing the submission.
  if (payload.value.honeypotTriggered) {
    return response.status(200).json({ ok: true, requestCode: syntheticRequestCode() });
  }

  const supabase = deps.serviceClient();
  if (!supabase) {
    logEvent('withdrawal_request_not_configured');
    return response.status(503).json({ error: 'Servicio no disponible.' });
  }

  const secret = process.env.COMMERCE_RATE_LIMIT_HASH_SECRET;
  const ip = trustedClientIp(request);
  if (!secret || !ip) {
    logEvent('withdrawal_request_rate_limit_unavailable');
    return response.status(503).json({ error: 'Servicio no disponible.' });
  }

  const requestId = randomUUID();
  const { data, error } = await supabase.rpc('public_create_withdrawal_request', {
    p_customer_name: payload.value.customerName,
    p_customer_email: payload.value.customerEmail,
    p_customer_phone: payload.value.customerPhone,
    p_order_reference: payload.value.orderReference,
    p_message: payload.value.message,
    p_request_id: requestId,
    p_rate_limit_subject_hash: keyedHash(`withdrawal:ip:${ip}`, secret),
  });

  if (error || !data) {
    const mapped = mapPublicSupportRpcError(error);
    if (mapped.status === 429) {
      const retryAfter = Number.parseInt(error?.details ?? '', 10);
      setRetryAfter(response, Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : 60);
    }
    logEvent('withdrawal_request_create_failed', { status: mapped.status, requestId });
    return response.status(mapped.status).json({ error: mapped.error });
  }

  const row = Array.isArray(data) ? data[0] : data;
  const requestCode = row && typeof row === 'object' && 'request_code' in row ? row.request_code : null;
  if (typeof requestCode !== 'string' || !REQUEST_CODE_PATTERN.test(requestCode)) {
    logEvent('withdrawal_request_invalid_response', { requestId });
    return response.status(500).json({ error: 'No disponible.' });
  }

  logEvent('withdrawal_request_created', { requestId });
  return response.status(200).json({ ok: true, requestCode });
}
