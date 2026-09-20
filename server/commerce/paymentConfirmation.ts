import { expectedLiveMode, logEvent, type MercadoPagoEnvironment } from './commerce.js';
import type { PreferenceBinding } from './mercadoPagoPayment.js';
import {
  createSupabasePaymentRepository,
  processMercadoPagoPayment,
  type MercadoPagoPayment,
  type PaymentProcessResult,
} from './paymentProcessing.js';

/** Binding actually used to tie a provider payment to a local order. */
export type ResolvedBinding = PreferenceBinding | 'order_external_reference';

export type ConfirmationOutcome = {
  result: PaymentProcessResult;
  binding: ResolvedBinding;
};

export type OrderPreferenceRow = { total_amount: number | string; currency: string; mercadopago_preference_id: string | null };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Single confirmation path shared by the signed webhook, the guest recovery
 * endpoint and admin reconciliation. Every channel reaches the same atomic RPC,
 * so deduplication holds across all of them.
 *
 * When the provider does not expose `preference_id` — the documented Payment
 * contract does not include it, and `/merchant_orders` answers 403 for this
 * token — the preference is taken from the order addressed by the payment's
 * `external_reference`. That leaves the authoritative bindings as: the payment
 * was read from this collector with our own access token, it carries our own
 * order UUID, and the RPC still enforces amount, currency, environment mode,
 * payment id agreement and transition legality.
 */
export async function confirmMercadoPagoPayment(
  supabase: any,
  payment: MercadoPagoPayment,
  options: {
    requestId: string | null;
    binding: PreferenceBinding;
    liveModeFieldPresent?: boolean;
    credentialMode?: string;
  },
): Promise<ConfirmationOutcome> {
  let binding: ResolvedBinding = options.binding;
  let preferenceId = typeof payment.preference_id === 'string' && payment.preference_id.trim() ? payment.preference_id : undefined;

  const order = await orderForPayment(supabase, payment.external_reference);
  if (!preferenceId && order.preferenceId) {
    preferenceId = order.preferenceId;
    binding = 'order_external_reference';
  }

  // Sanitized decision context, emitted before the RPC so a rejection can be
  // explained without the raw payload. Identifiers and booleans only: never a
  // token, a payer, an e-mail, a signature or the provider body.
  logEvent('payment_confirmation_context', {
    resourceId: safeResourceId(payment.id),
    liveModeFieldPresent: options.liveModeFieldPresent,
    liveModeValue: typeof payment.live_mode === 'boolean' ? String(payment.live_mode) : 'null',
    providerStatus: typeof payment.status === 'string' ? payment.status.toLowerCase().slice(0, 32) : undefined,
    externalReferenceMatches: order.found,
    preferenceBinding: binding,
    credentialMode: options.credentialMode,
  });

  const result = await processMercadoPagoPayment(
    createSupabasePaymentRepository(supabase),
    { ...payment, preference_id: preferenceId },
    { requestId: options.requestId },
  );
  return { result, binding };
}

/** Server-side only. The preference is never accepted from a client. */
export async function orderForPayment(supabase: any, externalReference: unknown): Promise<{ found: boolean; preferenceId: string | null }> {
  if (typeof externalReference !== 'string' || !UUID.test(externalReference)) return { found: false, preferenceId: null };
  const { data, error } = await supabase
    .from('orders')
    .select('mercadopago_preference_id')
    .eq('id', externalReference)
    .eq('external_reference', externalReference)
    .maybeSingle();
  if (error || !data) return { found: false, preferenceId: null };
  const preferenceId = (data as { mercadopago_preference_id?: unknown }).mercadopago_preference_id;
  return { found: true, preferenceId: typeof preferenceId === 'string' && preferenceId.trim() ? preferenceId : null };
}

function safeResourceId(value: unknown) {
  const id = String(value ?? '');
  return /^[A-Za-z0-9_-]{1,256}$/.test(id) ? id : undefined;
}

export type PaymentSelection =
  | { kind: 'selected'; payment: MercadoPagoPayment }
  | { kind: 'none' }
  | { kind: 'ambiguous'; candidates: number };

/** null means the payment matches the order. */
export type PaymentMismatchReason = 'external_reference' | 'live_mode' | 'currency' | 'amount' | 'environment_unknown';

/** The order carries its own immutable environment; the deployment variable is never consulted here. */
export type OrderEnvironment = { id: string; total_amount: number | string; currency: string; payment_environment?: string | null };

function orderEnvironment(order: OrderEnvironment): MercadoPagoEnvironment | null {
  const value = typeof order.payment_environment === 'string' ? order.payment_environment.trim().toLowerCase() : '';
  return value === 'test' || value === 'production' ? value : null;
}

// Terminal money states outrank provisional ones, so a rejected first attempt
// never masks the approved retry that actually paid the order.
const STATUS_RANK: Record<string, number> = {
  approved: 5,
  refunded: 4,
  charged_back: 4,
  pending: 3,
  in_process: 3,
  cancelled: 2,
  rejected: 2,
};

function sameAmount(amount: unknown, total: number) {
  const value = Number(amount);
  return Number.isFinite(value) && Number.isFinite(total) && Math.round(value * 100) === Math.round(total * 100);
}

/**
 * Picks exactly one payment for an order out of a provider search.
 *
 * The search envelope is a *summary*: `live_mode`, `currency_id` and
 * `transaction_amount` are all optional in the official contract. Requiring
 * them here silently discarded every real candidate, so selection binds on what
 * the summary always carries — the external reference and the status — and only
 * rejects the optional fields when they are present and disagree. The full
 * payment is then fetched and checked by {@link verifyPaymentMatchesOrder}.
 */
export function selectOrderPayment(payments: MercadoPagoPayment[], order: OrderEnvironment): PaymentSelection {
  const total = Number(order.total_amount);
  const currency = typeof order.currency === 'string' ? order.currency.toUpperCase() : '';
  const environment = orderEnvironment(order);
  // An order without a recognised environment can never be matched: failing
  // closed here is what keeps a TEST order from absorbing a real payment.
  if (!environment) return { kind: 'none' };
  const expected = expectedLiveMode(environment);
  const candidates = payments.filter((payment) => {
    const status = typeof payment.status === 'string' ? payment.status.toLowerCase() : '';
    if (payment.external_reference !== order.id || STATUS_RANK[status] === undefined) return false;
    if (payment.live_mode !== undefined && payment.live_mode !== expected) return false;
    if (payment.currency_id !== undefined && String(payment.currency_id).toUpperCase() !== currency) return false;
    if (payment.transaction_amount !== undefined && !sameAmount(payment.transaction_amount, total)) return false;
    return true;
  });
  if (candidates.length === 0) return { kind: 'none' };

  const ranked = candidates
    .map((payment) => ({ payment, rank: STATUS_RANK[String(payment.status).toLowerCase()] ?? 0 }))
    .sort((a, b) => b.rank - a.rank);
  const best = ranked[0];
  const tied = ranked.filter((entry) => entry.rank === best.rank);
  // Distinct provider payments at the same rank are a real double charge and
  // must be reviewed by a human, never resolved by picking one.
  const distinct = new Set(tied.map((entry) => String(entry.payment.id)));
  if (distinct.size > 1) return { kind: 'ambiguous', candidates: distinct.size };
  return { kind: 'selected', payment: best.payment };
}

/**
 * Authoritative check against the full payment returned by GET /v1/payments/{id},
 * which — unlike the search summary — always carries these fields. The atomic
 * RPC enforces the same invariants again; this fails closed earlier and says why.
 */
export function verifyPaymentMatchesOrder(payment: MercadoPagoPayment, order: OrderEnvironment): PaymentMismatchReason | null {
  if (payment.external_reference !== order.id) return 'external_reference';
  const environment = orderEnvironment(order);
  if (!environment) return 'environment_unknown';
  // Strict equality against the order's own environment. An absent live_mode is
  // still a rejection: unknown is never treated as TEST.
  if (payment.live_mode !== expectedLiveMode(environment)) return 'live_mode';
  const currency = typeof order.currency === 'string' ? order.currency.toUpperCase() : '';
  if (currency !== 'ARS' || String(payment.currency_id ?? '').toUpperCase() !== 'ARS') return 'currency';
  if (!sameAmount(payment.transaction_amount, Number(order.total_amount))) return 'amount';
  return null;
}
