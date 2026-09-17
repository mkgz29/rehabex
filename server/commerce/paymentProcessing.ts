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

export type AtomicPaymentInput = {
  requestId: string | null;
  paymentId: string;
  status: string;
  amount: number;
  currency: string;
  externalReference: string;
  preferenceId: string;
  liveMode: boolean | null;
  payloadHash: string;
};

export type PaymentRepository = {
  processAtomic: (input: AtomicPaymentInput) => Promise<{
    eventId: string | null;
    outcome: string | null;
    duplicate: boolean;
    error: boolean;
  }>;
};

export type PaymentProcessResult =
  | { kind: 'processed'; status: string; transition: string }
  | { kind: 'duplicate'; status: string }
  | { kind: 'rejected'; reason: 'payment_shape_invalid' | 'test_mode_required' | 'order_not_found' | 'payment_id_mismatch' | 'preference_mismatch' | 'amount_mismatch' | 'currency_mismatch' | 'transition_invalid' }
  | { kind: 'unavailable' };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PAYMENT_ID = /^[A-Za-z0-9_-]{1,256}$/;
const SUPPORTED_STATUSES = new Set(['approved', 'pending', 'in_process', 'rejected', 'cancelled', 'refunded', 'charged_back']);

const REJECTED_OUTCOMES: Record<string, Extract<PaymentProcessResult, { kind: 'rejected' }>['reason']> = {
  rejected_payment_shape: 'payment_shape_invalid',
  rejected_test_mode: 'test_mode_required',
  rejected_order_not_found: 'order_not_found',
  rejected_payment_id_mismatch: 'payment_id_mismatch',
  rejected_preference_mismatch: 'preference_mismatch',
  rejected_amount_mismatch: 'amount_mismatch',
  rejected_currency_mismatch: 'currency_mismatch',
  ignored_invalid_transition: 'transition_invalid',
};

/**
 * Both signed webhooks and admin reconciliation use this exact path. The
 * database RPC owns deduplication, validation, event persistence, transitions,
 * reservations and inventory in one transaction.
 */
export async function processMercadoPagoPayment(
  repository: PaymentRepository,
  payment: MercadoPagoPayment,
  options: { requestId: string | null },
): Promise<PaymentProcessResult> {
  const paymentId = typeof payment.id === 'string' || typeof payment.id === 'number' ? String(payment.id) : '';
  const externalReference = typeof payment.external_reference === 'string' ? payment.external_reference : '';
  const preferenceId = typeof payment.preference_id === 'string' ? payment.preference_id : '';
  const status = typeof payment.status === 'string' ? payment.status.toLowerCase() : '';
  const amount = paymentAmount(payment.transaction_amount);
  const currency = typeof payment.currency_id === 'string' ? payment.currency_id.toUpperCase() : '';
  const liveMode = typeof payment.live_mode === 'boolean' ? payment.live_mode : null;
  if (!PAYMENT_ID.test(paymentId) || !UUID.test(externalReference) || !preferenceId || !SUPPORTED_STATUSES.has(status) || amount === null || !currency) {
    return { kind: 'rejected', reason: 'payment_shape_invalid' };
  }

  const result = await repository.processAtomic({
    requestId: options.requestId,
    paymentId,
    status,
    amount,
    currency,
    externalReference,
    preferenceId,
    liveMode,
    payloadHash: hash(`${paymentId}:${status}:${externalReference}:${preferenceId}:${amount}:${currency}:${String(liveMode)}`),
  });
  if (result.error || !result.outcome) return { kind: 'unavailable' };
  if (result.duplicate || result.outcome === 'duplicate') return { kind: 'duplicate', status };
  const rejectedReason = REJECTED_OUTCOMES[result.outcome];
  if (rejectedReason) return { kind: 'rejected', reason: rejectedReason };
  return { kind: 'processed', status, transition: result.outcome };
}

export function createSupabasePaymentRepository(supabase: any): PaymentRepository {
  return {
    async processAtomic(input) {
      const { data, error } = await supabase.rpc('process_mercadopago_payment_atomic', {
        p_request_id: input.requestId,
        p_provider_payment_id: input.paymentId,
        p_external_reference: input.externalReference,
        p_preference_id: input.preferenceId,
        p_payment_status: input.status,
        p_amount: input.amount,
        p_currency: input.currency,
        p_live_mode: input.liveMode,
        p_payload_hash: input.payloadHash,
      });
      const row = Array.isArray(data) && data.length === 1
        ? data[0] as { event_id?: string; outcome?: string; is_duplicate?: boolean }
        : null;
      return {
        eventId: typeof row?.event_id === 'string' ? row.event_id : null,
        outcome: typeof row?.outcome === 'string' ? row.outcome : null,
        duplicate: Boolean(row?.is_duplicate),
        error: Boolean(error) || !row,
      };
    },
  };
}

function paymentAmount(value: unknown) {
  if ((typeof value !== 'number' && typeof value !== 'string') || value === '') return null;
  const amount = Number(value);
  return Number.isFinite(amount) && amount >= 0 ? amount : null;
}
