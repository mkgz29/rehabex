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
 * so deduplication by (provider, payment id, status) holds across all of them.
 *
 * When the provider does not expose `preference_id` — the documented Payment
 * contract does not include it, and `/merchant_orders` answers 403 for this
 * token — the preference is taken from the order addressed by the payment's
 * `external_reference`. That leaves the authoritative bindings as: the payment
 * was read from this collector with our own access token, it carries our own
 * order UUID, and the RPC still enforces amount, currency, TEST mode, payment
 * id agreement and transition legality.
 */
export async function confirmMercadoPagoPayment(
  supabase: any,
  payment: MercadoPagoPayment,
  options: { requestId: string | null; binding: PreferenceBinding },
): Promise<ConfirmationOutcome> {
  let binding: ResolvedBinding = options.binding;
  let preferenceId = typeof payment.preference_id === 'string' && payment.preference_id.trim() ? payment.preference_id : undefined;

  if (!preferenceId) {
    const derived = await orderPreferenceId(supabase, payment.external_reference);
    if (derived) {
      preferenceId = derived;
      binding = 'order_external_reference';
    }
  }

  const result = await processMercadoPagoPayment(
    createSupabasePaymentRepository(supabase),
    { ...payment, preference_id: preferenceId },
    { requestId: options.requestId },
  );
  return { result, binding };
}

/** Server-side only. The preference is never accepted from a client. */
export async function orderPreferenceId(supabase: any, externalReference: unknown): Promise<string | null> {
  if (typeof externalReference !== 'string' || !UUID.test(externalReference)) return null;
  const { data, error } = await supabase
    .from('orders')
    .select('mercadopago_preference_id')
    .eq('id', externalReference)
    .eq('external_reference', externalReference)
    .maybeSingle();
  if (error || !data) return null;
  const preferenceId = (data as { mercadopago_preference_id?: unknown }).mercadopago_preference_id;
  return typeof preferenceId === 'string' && preferenceId.trim() ? preferenceId : null;
}

export type PaymentSelection =
  | { kind: 'selected'; payment: MercadoPagoPayment }
  | { kind: 'none' }
  | { kind: 'ambiguous'; candidates: number };

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

/**
 * Picks exactly one payment for an order out of a provider search.
 *
 * Candidates must match the order on external reference, TEST mode, currency
 * and total. Two payments tied at the highest rank (for example two approved
 * charges) are reported as ambiguous and never processed automatically.
 */
export function selectOrderPayment(payments: MercadoPagoPayment[], order: { id: string; total_amount: number | string; currency: string }): PaymentSelection {
  const total = Number(order.total_amount);
  const currency = typeof order.currency === 'string' ? order.currency.toUpperCase() : '';
  const candidates = payments.filter((payment) => {
    const status = typeof payment.status === 'string' ? payment.status.toLowerCase() : '';
    const amount = Number(payment.transaction_amount);
    return payment.external_reference === order.id
      && payment.live_mode === false
      && typeof payment.currency_id === 'string'
      && payment.currency_id.toUpperCase() === currency
      && currency === 'ARS'
      && Number.isFinite(total)
      && Number.isFinite(amount)
      && Math.round(amount * 100) === Math.round(total * 100)
      && STATUS_RANK[status] !== undefined;
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
