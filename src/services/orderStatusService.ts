import type { CheckoutSnapshot } from '../cart/checkoutSnapshot';

export type OrderStatusRecord = {
  payment_status: string;
  order_status: string;
};

export type PaymentConfirmationState = 'approved' | 'pending' | 'rejected' | 'unknown';

export function classifyPaymentConfirmation(order: OrderStatusRecord | null): PaymentConfirmationState {
  if (!order) return 'unknown';
  if (order.payment_status === 'approved' && order.order_status === 'confirmed') return 'approved';
  if (order.payment_status === 'rejected' || order.payment_status === 'cancelled' || order.order_status === 'cancelled') return 'rejected';
  if (order.payment_status === 'pending' || order.payment_status === 'in_process' || order.order_status === 'pending_payment') return 'pending';
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
