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
import { parsePublicSupportIntakePayload } from '../server/support/publicValidators.js';

// Public, unauthenticated endpoint (ADMIN-03B): the only approved path from
// an anonymous visitor to public.support_requests. The browser never talks
// to Supabase directly here -- this function holds the service_role key
// (serviceClient()) and is the sole caller of public_create_support_request,
// which is itself granted to service_role only. Same CORS/body-size/
// rate-limit shape as api/checkout.ts, without modifying that file or its
// commerce-scoped rate-limit table: support intake gets its own rate-limit
// table and RPC (203610080101_admin_03b), consumed internally by
// public_create_support_request itself.
export const config = { api: { bodyParser: false } };

const MAX_BODY_BYTES = 16 * 1024;

type SupportIntakeDependencies = { serviceClient: typeof serviceClient };
const defaultDependencies: SupportIntakeDependencies = { serviceClient };

// The optional third parameter exists only for tests to inject a fake
// Supabase client; Vercel always invokes this with exactly (request,
// response), so production behavior is unchanged (same convention as
// api/orders.ts).
export default async function handler(request: ApiRequest, response: ApiResponse, deps: SupportIntakeDependencies = defaultDependencies) {
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

  const payload = parsePublicSupportIntakePayload(body.value);
  if (!payload.ok) return response.status(400).json({ error: 'Solicitud invalida.' });

  // Honeypot: a bot that filled the hidden field gets the exact same success
  // response as a real submission, with no RPC call and no row created.
  // Never respond differently for a detected bot -- that itself would be a
  // detectable signal.
  if (payload.value.honeypotTriggered) {
    return response.status(200).json({ ok: true });
  }

  const supabase = deps.serviceClient();
  if (!supabase) {
    logEvent('support_intake_not_configured');
    return response.status(503).json({ error: 'Soporte no disponible.' });
  }

  // Same hashed-IP convention as checkout's own rate limit (never the raw
  // IP), using the existing shared secret -- it is a generic HMAC key for
  // this exact purpose, not something owned by checkout.
  const secret = process.env.COMMERCE_RATE_LIMIT_HASH_SECRET;
  const ip = trustedClientIp(request);
  if (!secret || !ip) {
    logEvent('support_intake_rate_limit_unavailable');
    return response.status(503).json({ error: 'Soporte no disponible.' });
  }
  const rateLimitSubjectHash = keyedHash(`ip:${ip}`, secret);

  // Generated here, never accepted from the client -- the RPC's own
  // admin_audit_events-style request_id convention, used only for the DB
  // function's internal bookkeeping (it writes no audit row for a public
  // submission; see the migration's own note on that).
  const requestId = randomUUID();

  const { data, error } = await supabase.rpc('public_create_support_request', {
    p_customer_name: payload.value.customerName,
    p_customer_email: payload.value.customerEmail,
    p_customer_phone: payload.value.customerPhone,
    p_topic: payload.value.topic,
    p_subject: payload.value.subject,
    p_message: payload.value.message,
    p_order_reference: payload.value.orderReference,
    p_request_id: requestId,
    p_rate_limit_subject_hash: rateLimitSubjectHash,
  });

  if (error || !data) {
    const mapped = mapPublicSupportRpcError(error);
    if (mapped.status === 429) {
      const retryAfter = Number.parseInt(error?.details ?? '', 10);
      setRetryAfter(response, Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : 60);
    }
    logEvent('support_intake_create_failed', { status: mapped.status, requestId });
    return response.status(mapped.status).json({ error: mapped.error });
  }

  logEvent('support_intake_created', { requestId });
  return response.status(200).json({ ok: true });
}
