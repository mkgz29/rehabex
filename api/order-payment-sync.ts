import {
  applyCors,
  consumeRateLimit,
  hash,
  header,
  isJsonContentType,
  logEvent,
  MAX_ORDER_STATUS_BODY_BYTES,
  readJsonBody,
  serviceClient,
  setRetryAfter,
  type ApiRequest,
  type ApiResponse,
} from '../server/commerce/commerce.js';
import { confirmMercadoPagoPayment, selectOrderPayment, verifyPaymentMatchesOrder } from '../server/commerce/paymentConfirmation.js';
import type { MercadoPagoPayment } from '../server/commerce/paymentProcessing.js';
import {
  fetchMercadoPagoPayment,
  searchMercadoPagoPaymentsByExternalReference,
  type MercadoPagoProviderResult,
  type MercadoPagoSearchResult,
} from '../server/commerce/mercadoPagoPayment.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const STATUS_TOKEN = /^[A-Za-z0-9_-]{43}$/;
const RECOVERY_COOLDOWN_SECONDS = 30;
const PUBLIC_ORDER_COLUMNS = 'id, order_number, payment_status, order_status, fulfillment_status, total_amount, currency, refund_required, created_at';

export const config = { api: { bodyParser: false } };

/** Coarse, non-sensitive outcome surfaced to the guest browser. */
export type RecoveryOutcome =
  | 'already_settled'
  | 'confirmed'
  | 'duplicate'
  | 'no_payment_found'
  | 'ambiguous_payments'
  | 'not_applicable'
  | 'provider_unavailable'
  | 'cooldown'
  | 'payment_mismatch'
  | 'rejected';

type OrderRow = {
  id: string;
  payment_status: string;
  order_status: string;
  total_amount: number | string;
  currency: string;
  mercadopago_preference_id: string | null;
};

type SyncDependencies = {
  serviceClient: typeof serviceClient;
  consumeRateLimit: typeof consumeRateLimit;
  searchPayments: typeof searchMercadoPagoPaymentsByExternalReference;
  fetchPayment: typeof fetchMercadoPagoPayment;
};

// A payment the provider already settled needs no recovery lookup.
const SETTLED = new Set(['approved', 'rejected', 'cancelled', 'refunded', 'charged_back']);

export function createOrderPaymentSyncHandler(dependencies: SyncDependencies = {
  serviceClient,
  consumeRateLimit,
  searchPayments: searchMercadoPagoPaymentsByExternalReference,
  fetchPayment: fetchMercadoPagoPayment,
}) {
  return async function handler(request: ApiRequest, response: ApiResponse) {
    if (!applyCors(request, response)) return response.status(403).json({ error: 'Origen no permitido.' });
    if (request.method === 'OPTIONS') return response.status(204).end?.();
    if (request.method !== 'POST') {
      response.setHeader?.('Allow', 'POST, OPTIONS');
      return response.status(405).json({ error: 'Metodo no permitido.' });
    }
    if (!isJsonContentType(request)) return response.status(415).json({ error: 'Orden no encontrada.' });

    const parsed = await readJsonBody(request, MAX_ORDER_STATUS_BODY_BYTES);
    const orderId = parsed.ok ? parseOrderPaymentSyncPayload(parsed.value) : null;
    const token = header(request, 'x-order-status-token');
    // The guest token is the only authorization. Nothing about the payment
    // itself is ever accepted from the client.
    if (!orderId || !token || !STATUS_TOKEN.test(token)) return response.status(404).json({ error: 'Orden no encontrada.' });

    const supabase = dependencies.serviceClient();
    if (!supabase) return response.status(503).json({ error: 'Servicio no disponible.' });

    const rateLimit = await dependencies.consumeRateLimit(supabase, 'order_status', request);
    if (rateLimit.unavailable) {
      logEvent('payment_sync_rate_limit_unavailable');
      return response.status(503).json({ error: 'Servicio no disponible.' });
    }
    if (!rateLimit.ok) {
      setRetryAfter(response, rateLimit.retryAfter);
      return response.status(429).json({ error: 'Demasiadas solicitudes.' });
    }

    const { data: order, error } = await supabase
      .from('orders')
      .select(`${PUBLIC_ORDER_COLUMNS}, mercadopago_preference_id`)
      .eq('id', orderId)
      .eq('status_access_token_hash', hash(token))
      .maybeSingle();
    if (error || !order) {
      logEvent('payment_sync_denied');
      return response.status(404).json({ error: 'Orden no encontrada.' });
    }
    const current = order as OrderRow;

    // Opportunistic, bounded and best effort. Frees holds whose window closed so
    // they stop counting against availability for everyone else.
    try { await supabase.rpc('expire_stale_commerce_holds', { p_limit: 50 }); } catch { /* never blocks a status read */ }

    if (SETTLED.has(String(current.payment_status))) {
      return respond(response, supabase, orderId, 'already_settled');
    }
    if (!current.mercadopago_preference_id) {
      return respond(response, supabase, orderId, 'not_applicable');
    }

    const accessToken = process.env.MERCADOPAGO_ACCESS_TOKEN;
    if (!accessToken) {
      logEvent('payment_sync_not_configured');
      return respond(response, supabase, orderId, 'provider_unavailable');
    }

    const claim = await claimRecoveryAttempt(supabase, orderId);
    if (!claim.allowed) {
      setRetryAfter(response, claim.retryAfter);
      return respond(response, supabase, orderId, 'cooldown');
    }

    let search: MercadoPagoSearchResult;
    try {
      search = await dependencies.searchPayments(orderId, accessToken);
    } catch {
      logSyncFailure(orderId, 'payment_search', 'provider_payment_search_network_error');
      return respond(response, supabase, orderId, 'provider_unavailable');
    }
    if (search.kind !== 'ok') {
      logSyncFailure(orderId, search.stage, search.errorCode, search.httpStatus);
      return respond(response, supabase, orderId, 'provider_unavailable');
    }

    // The search envelope is what the provider actually returned. Recording its
    // size and the sanitized shape of each row is the only way to tell "Mercado
    // Pago knows of no payment" apart from "our filter discarded them all".
    const selection = selectOrderPayment(search.payments, current);
    if (selection.kind === 'none') {
      logEvent('payment_sync_no_match', { orderId, searchResults: search.payments.length });
      logSearchCandidates(orderId, search.payments);
      return respond(response, supabase, orderId, 'no_payment_found');
    }
    if (selection.kind === 'ambiguous') {
      // Two provider payments that both satisfy the order is a double charge.
      // It is surfaced for human review and never resolved automatically.
      logEvent('payment_sync_ambiguous', { orderId, candidates: selection.candidates });
      return respond(response, supabase, orderId, 'ambiguous_payments');
    }

    const resourceId = String(selection.payment.id ?? '');
    let provider: MercadoPagoProviderResult;
    try {
      provider = await dependencies.fetchPayment(resourceId, accessToken);
    } catch {
      logSyncFailure(orderId, 'payment_fetch', 'provider_payment_network_error', undefined, resourceId);
      return respond(response, supabase, orderId, 'provider_unavailable');
    }
    if (provider.kind !== 'ok') {
      logSyncFailure(orderId, provider.stage, provider.errorCode, provider.httpStatus, resourceId);
      return respond(response, supabase, orderId, 'provider_unavailable');
    }

    // Authoritative gate on the full payment, which always carries these fields.
    const mismatch = verifyPaymentMatchesOrder(provider.payment, current);
    if (mismatch) {
      logEvent('payment_sync_mismatch', { orderId, resourceId, reason: mismatch });
      return respond(response, supabase, orderId, 'payment_mismatch');
    }

    let outcome: RecoveryOutcome;
    try {
      const { result, binding } = await confirmMercadoPagoPayment(supabase, provider.payment, {
        requestId: null,
        binding: provider.preferenceBinding,
      });
      if (result.kind === 'unavailable') {
        logSyncFailure(orderId, 'atomic_rpc', 'atomic_rpc_unavailable', undefined, resourceId);
        return respond(response, supabase, orderId, 'provider_unavailable');
      }
      if (result.kind === 'rejected') {
        logEvent('payment_sync_rejected', { orderId, resourceId, reason: result.reason, preferenceBinding: binding });
        outcome = 'rejected';
      } else if (result.kind === 'duplicate') {
        outcome = 'duplicate';
      } else {
        logEvent('payment_sync_processed', { orderId, resourceId, paymentStatus: result.status, preferenceBinding: binding });
        outcome = 'confirmed';
      }
    } catch {
      logSyncFailure(orderId, 'atomic_rpc', 'atomic_rpc_error', undefined, resourceId);
      return respond(response, supabase, orderId, 'provider_unavailable');
    }

    return respond(response, supabase, orderId, outcome);
  };
}

export default createOrderPaymentSyncHandler();

export function parseOrderPaymentSyncPayload(value: unknown): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const body = value as Record<string, unknown>;
  if (Object.keys(body).length !== 1 || Object.keys(body)[0] !== 'orderId') return null;
  const orderId = typeof body.orderId === 'string' ? body.orderId.trim() : '';
  return UUID.test(orderId) ? orderId : null;
}

async function claimRecoveryAttempt(supabase: any, orderId: string) {
  try {
    const { data, error } = await supabase.rpc('claim_payment_recovery_attempt', {
      p_order_id: orderId,
      p_cooldown_seconds: RECOVERY_COOLDOWN_SECONDS,
    });
    const row = Array.isArray(data) && data.length === 1 ? data[0] as { allowed?: boolean; retry_after_seconds?: number } : null;
    if (error || !row) return { allowed: false, retryAfter: RECOVERY_COOLDOWN_SECONDS };
    return { allowed: Boolean(row.allowed), retryAfter: Number(row.retry_after_seconds) || RECOVERY_COOLDOWN_SECONDS };
  } catch {
    return { allowed: false, retryAfter: RECOVERY_COOLDOWN_SECONDS };
  }
}

/** Always answers with the persisted order, never with anything the provider said. */
async function respond(response: ApiResponse, supabase: any, orderId: string, recovery: RecoveryOutcome) {
  const { data, error } = await supabase
    .from('orders')
    .select(PUBLIC_ORDER_COLUMNS)
    .eq('id', orderId)
    .maybeSingle();
  if (error || !data) return response.status(503).json({ error: 'Servicio no disponible.' });
  return response.status(200).json({ order: data, recovery });
}

function logSyncFailure(orderId: string, stage: string, errorCode: string, providerHttpStatus?: number, resourceId?: string) {
  const context: Record<string, string | number | boolean | undefined> = {
    orderId,
    stage: safeCode(stage),
    errorCode: safeCode(errorCode),
  };
  if (typeof providerHttpStatus === 'number' && Number.isInteger(providerHttpStatus) && providerHttpStatus >= 100 && providerHttpStatus <= 599) {
    context.providerHttpStatus = providerHttpStatus;
  }
  if (resourceId && /^[A-Za-z0-9_-]{1,256}$/.test(resourceId)) context.resourceId = resourceId;
  // Stage, allowlisted code, HTTP status and opaque provider ids only. Never
  // tokens, signatures, provider payloads, buyer data or order contents.
  logEvent('payment_sync_failed', context);
}

/** Opaque provider identifiers and money shape only. Never payer data. */
function logSearchCandidates(orderId: string, payments: MercadoPagoPayment[]) {
  for (const payment of payments.slice(0, 5)) {
    const id = String(payment.id ?? '');
    logEvent('payment_sync_candidate', {
      orderId,
      resourceId: /^[A-Za-z0-9_-]{1,256}$/.test(id) ? id : undefined,
      status: typeof payment.status === 'string' ? safeCode(payment.status.toLowerCase()) : undefined,
      liveMode: typeof payment.live_mode === 'boolean' ? payment.live_mode : undefined,
      currency: typeof payment.currency_id === 'string' ? payment.currency_id.toUpperCase().slice(0, 8) : undefined,
      amount: Number.isFinite(Number(payment.transaction_amount)) ? Number(payment.transaction_amount) : undefined,
      referenceMatches: payment.external_reference === orderId,
    });
  }
}

function safeCode(value: unknown) {
  return typeof value === 'string' && /^[a-z0-9_]{1,80}$/.test(value) ? value : 'payment_sync_error';
}
