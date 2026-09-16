import { hash } from './commerce.js';

export type MercadoPagoPayment = {
  id?: string | number;
  status?: string;
  transaction_amount?: number | string;
  currency_id?: string;
  external_reference?: string;
  preference_id?: string;
  live_mode?: boolean;
};

export type CommerceOrder = {
  id: string;
  external_reference: string;
  total_amount: number | string;
  currency: string;
  mercadopago_preference_id: string | null;
  mercadopago_payment_id: string | null;
};

export type PaymentRepository = {
  findOrdersByExternalReference: (externalReference: string) => Promise<{ orders: CommerceOrder[]; error: boolean }>;
  recordEvent: (input: {
    dedupeKey: string;
    requestId: string | null;
    paymentId: string;
    orderId: string;
    externalReference: string;
    payloadHash: string;
    status: string;
  }) => Promise<{ eventId: string | null; duplicate: boolean; error: boolean }>;
  applyTransition: (input: {
    eventId: string;
    orderId: string;
    paymentId: string;
    status: string;
    amount: number;
    currency: string;
    externalReference: string;
    preferenceId: string;
  }) => Promise<{ result: string | null; error: boolean }>;
};

export type PaymentProcessResult =
  | { kind: 'processed'; status: string; transition: string | null }
  | { kind: 'duplicate'; status: string }
  | { kind: 'rejected'; reason: 'payment_shape_invalid' | 'test_mode_required' | 'order_not_found' | 'order_ambiguous' | 'payment_id_mismatch' | 'preference_mismatch' | 'amount_mismatch' | 'currency_mismatch' }
  | { kind: 'unavailable' };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PAYMENT_ID = /^[A-Za-z0-9_-]{1,256}$/;
const SUPPORTED_STATUSES = new Set(['approved', 'pending', 'in_process', 'rejected', 'cancelled', 'refunded', 'charged_back']);

/**
 * Server-only provider authority path used by both signed webhooks and manual
 * admin reconciliation. The caller never supplies order, amount, currency, or
 * payment status: all of them are taken from Mercado Pago's response.
 */
export async function processMercadoPagoPayment(
  repository: PaymentRepository,
  payment: MercadoPagoPayment,
  options: { dedupeSeed: string; requestId: string | null; requireTestMode: boolean },
): Promise<PaymentProcessResult> {
  if (options.requireTestMode && payment.live_mode !== false) return { kind: 'rejected', reason: 'test_mode_required' };

  const paymentId = typeof payment.id === 'string' || typeof payment.id === 'number' ? String(payment.id) : '';
  const externalReference = typeof payment.external_reference === 'string' ? payment.external_reference : '';
  const preferenceId = typeof payment.preference_id === 'string' ? payment.preference_id : '';
  const status = typeof payment.status === 'string' ? payment.status.toLowerCase() : '';
  const amount = paymentAmount(payment.transaction_amount);
  const currency = typeof payment.currency_id === 'string' ? payment.currency_id.toUpperCase() : '';
  if (!PAYMENT_ID.test(paymentId) || !UUID.test(externalReference) || !preferenceId || !SUPPORTED_STATUSES.has(status) || amount === null || !currency) {
    return { kind: 'rejected', reason: 'payment_shape_invalid' };
  }

  const orderResult = await repository.findOrdersByExternalReference(externalReference);
  if (orderResult.error) return { kind: 'unavailable' };
  if (orderResult.orders.length === 0) return { kind: 'rejected', reason: 'order_not_found' };
  if (orderResult.orders.length !== 1) return { kind: 'rejected', reason: 'order_ambiguous' };
  const order = orderResult.orders[0];
  if (!order || order.id !== externalReference || order.external_reference !== externalReference) return { kind: 'rejected', reason: 'order_not_found' };
  if (order.mercadopago_payment_id && order.mercadopago_payment_id !== paymentId) return { kind: 'rejected', reason: 'payment_id_mismatch' };
  if (order.mercadopago_preference_id !== preferenceId) return { kind: 'rejected', reason: 'preference_mismatch' };
  if (!sameAmount(order.total_amount, amount)) return { kind: 'rejected', reason: 'amount_mismatch' };
  if (order.currency !== 'ARS' || currency !== 'ARS') return { kind: 'rejected', reason: 'currency_mismatch' };

  const eventResult = await repository.recordEvent({
    dedupeKey: hash(`${options.dedupeSeed}:${paymentId}:${status}`),
    requestId: options.requestId,
    paymentId,
    orderId: order.id,
    externalReference,
    payloadHash: hash(`${paymentId}:${status}:${externalReference}:${preferenceId}:${amount}:${currency}`),
    status,
  });
  if (eventResult.error || !eventResult.eventId) return { kind: 'unavailable' };
  if (eventResult.duplicate) return { kind: 'duplicate', status };

  const transition = await repository.applyTransition({
    eventId: eventResult.eventId,
    orderId: order.id,
    paymentId,
    status,
    amount,
    currency,
    externalReference,
    preferenceId,
  });
  if (transition.error) return { kind: 'unavailable' };
  return { kind: 'processed', status, transition: transition.result };
}

export function createSupabasePaymentRepository(supabase: any): PaymentRepository {
  return {
    async findOrdersByExternalReference(externalReference) {
      const { data, error } = await supabase
        .from('orders')
        .select('id, external_reference, total_amount, currency, mercadopago_preference_id, mercadopago_payment_id')
        .eq('external_reference', externalReference)
        .limit(2);
      return { orders: Array.isArray(data) ? data as CommerceOrder[] : [], error: Boolean(error) };
    },
    async recordEvent(input) {
      const { data, error } = await supabase.rpc('record_mercadopago_payment_event', {
        p_dedupe_key: input.dedupeKey,
        p_request_id: input.requestId,
        p_provider_event_id: null,
        p_provider_payment_id: input.paymentId,
        p_order_id: input.orderId,
        p_external_reference: input.externalReference,
        p_payload_hash: input.payloadHash,
        p_provider_status: input.status,
      });
      const row = Array.isArray(data) && data.length === 1 ? data[0] as { event_id?: string; is_duplicate?: boolean } : null;
      return { eventId: typeof row?.event_id === 'string' ? row.event_id : null, duplicate: Boolean(row?.is_duplicate), error: Boolean(error) || !row };
    },
    async applyTransition(input) {
      const { data, error } = await supabase.rpc('apply_mercadopago_payment_transition', {
        p_event_id: input.eventId,
        p_order_id: input.orderId,
        p_payment_id: input.paymentId,
        p_payment_status: input.status,
        p_amount: input.amount,
        p_currency: input.currency,
        p_external_reference: input.externalReference,
        p_preference_id: input.preferenceId,
      });
      return { result: typeof data === 'string' ? data : null, error: Boolean(error) };
    },
  };
}

function paymentAmount(value: unknown) {
  if ((typeof value !== 'number' && typeof value !== 'string') || value === '') return null;
  const amount = Number(value);
  return Number.isFinite(amount) && amount >= 0 ? amount : null;
}

function sameAmount(expected: number | string, received: number) {
  const amount = Number(expected);
  return Number.isFinite(amount) && Math.round(amount * 100) === Math.round(received * 100);
}
