import type { CheckoutSnapshot } from '../cart/checkoutSnapshot';

export type OrderStatusRecord = {
  payment_status: string;
  order_status: string;
};

export type PaymentConfirmationState = 'approved' | 'pending' | 'rejected' | 'expired' | 'unknown';

/** Coarse outcome reported by the recovery endpoint. Mirrors the server union. */
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
  | 'rejected'
  | 'rate_limited'
  | 'unreachable';

export type PaymentSyncResult = {
  state: PaymentConfirmationState;
  recovery: RecoveryOutcome;
  retryAfterSeconds: number | null;
};

export function classifyPaymentConfirmation(order: OrderStatusRecord | null): PaymentConfirmationState {
  if (!order) return 'unknown';
  if (order.payment_status === 'approved' && order.order_status === 'confirmed') return 'approved';
  if (order.payment_status === 'rejected' || order.payment_status === 'cancelled' || order.order_status === 'cancelled') return 'rejected';
  if (order.payment_status === 'pending' || order.payment_status === 'in_process' || order.order_status === 'pending_payment') return 'pending';
  // The checkout window closed with no payment recorded. A late approval still
  // transitions the order server-side, so this is not a terminal claim.
  if (order.order_status === 'expired') return 'expired';
  return 'unknown';
}

export async function requestOrderStatus(snapshot: CheckoutSnapshot, request: typeof fetch = fetch): Promise<PaymentConfirmationState> {
  const response = await request('/api/order-status', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Order-Status-Token': snapshot.statusToken },
    body: JSON.stringify({ orderId: snapshot.orderId }),
  });
  if (!response.ok) return 'unknown';
  const data = await response.json().catch(() => null) as { order?: OrderStatusRecord } | null;
  return classifyPaymentConfirmation(data?.order ?? null);
}

/**
 * Asks the backend to confirm the payment server-to-server when a webhook may
 * have been lost, and returns the persisted order state. The browser never
 * supplies a payment id, amount or status; it only proves it owns the order
 * with the guest token.
 */
export async function requestPaymentSync(snapshot: CheckoutSnapshot, request: typeof fetch = fetch): Promise<PaymentSyncResult> {
  let response: Response;
  try {
    response = await request('/api/order-payment-sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Order-Status-Token': snapshot.statusToken },
      body: JSON.stringify({ orderId: snapshot.orderId }),
    });
  } catch {
    return { state: 'unknown', recovery: 'unreachable', retryAfterSeconds: null };
  }
  const retryAfterSeconds = retryAfter(response);
  if (response.status === 429) return { state: 'unknown', recovery: 'rate_limited', retryAfterSeconds };
  if (!response.ok) return { state: 'unknown', recovery: 'provider_unavailable', retryAfterSeconds };
  const data = await response.json().catch(() => null) as { order?: OrderStatusRecord; recovery?: RecoveryOutcome } | null;
  return {
    state: classifyPaymentConfirmation(data?.order ?? null),
    recovery: data?.recovery ?? 'provider_unavailable',
    retryAfterSeconds,
  };
}

export type OrderTrackingRecord = OrderStatusRecord & {
  order_number: string;
  fulfillment_status: string | null;
  delivery_method: string | null;
};

export type OrderTrackingResult =
  | { ok: true; order: OrderTrackingRecord; fulfillmentTimeline: Array<{ to_status: string; created_at: string }> }
  | { ok: false };

/**
 * FASE 7F-B4. Used by /mi-pedido: the (orderId, token) pair comes from the
 * URL fragment (see src/lib/orderTrackingLink.ts), never from a
 * CheckoutSnapshot in sessionStorage -- this is the one call site that talks
 * to /api/order-status directly instead of through requestOrderStatus.
 */
export async function requestOrderTracking(orderId: string, token: string, request: typeof fetch = fetch): Promise<OrderTrackingResult> {
  let response: Response;
  try {
    response = await request('/api/order-status', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Order-Status-Token': token },
      body: JSON.stringify({ orderId }),
    });
  } catch {
    return { ok: false };
  }
  if (!response.ok) return { ok: false };
  const data = await response.json().catch(() => null) as { order?: OrderTrackingRecord; fulfillmentTimeline?: Array<{ to_status: string; created_at: string }> } | null;
  if (!data?.order) return { ok: false };
  return { ok: true, order: data.order, fulfillmentTimeline: data.fulfillmentTimeline ?? [] };
}

function retryAfter(response: Pick<Response, 'headers'>) {
  const value = response.headers?.get?.('Retry-After') ?? null;
  if (!value || !/^\d+$/.test(value)) return null;
  const seconds = Number(value);
  return Number.isFinite(seconds) && seconds > 0 ? Math.min(seconds, 3600) : null;
}
