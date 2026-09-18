/** Contract returned by /api/orders. Mirrors the explicit projection there. */
export type AdminOrder = {
  id?: string | null;
  order_number?: string | null;
  created_at?: string | null;
  paid_at?: string | null;
  payment_status?: string | null;
  order_status?: string | null;
  fulfillment_status?: string | null;
  total_amount?: number | string | null;
  currency?: string | null;
  delivery_method?: string | null;
  customer_email?: string | null;
  customer_name?: string | null;
  mercadopago_payment_id?: string | null;
  mercadopago_preference_id?: string | null;
  review_required?: boolean | null;
  review_reason?: string | null;
  refund_required?: boolean | null;
  order_items?: unknown;
};

export type AttentionLevel = 'settled' | 'waiting' | 'attention';

/**
 * What an operator must act on, derived from the persisted order only.
 *
 * `attention` means money and state disagree or a human decision is pending.
 * `waiting` means Mercado Pago has not confirmed yet and nothing is wrong.
 */
export function attentionLevel(order: AdminOrder): AttentionLevel {
  if (order.review_required === true || order.refund_required === true) return 'attention';
  const payment = order.payment_status ?? '';
  const status = order.order_status ?? '';
  if (status === 'on_hold' || payment === 'charged_back') return 'attention';
  // Approved money that never reached a confirmed order is exactly the failure
  // this audit chased: it must be visible, not buried as a normal sale.
  if (payment === 'approved' && status !== 'confirmed' && status !== 'completed') return 'attention';
  if (payment === 'approved') return 'settled';
  if (payment === 'rejected' || payment === 'cancelled' || payment === 'refunded' || status === 'expired') return 'settled';
  return 'waiting';
}

export function paymentLabel(order: AdminOrder) {
  return order.payment_status?.trim() || 'sin estado';
}

export function orderLabel(order: AdminOrder) {
  return order.order_status?.trim() || 'sin estado';
}

export function orderReference(order: AdminOrder) {
  return order.order_number?.trim() || (typeof order.id === 'string' ? order.id.slice(0, 8) : 'sin numero');
}

export function paymentReference(order: AdminOrder) {
  return order.mercadopago_payment_id?.trim() || 'sin pago';
}

/** Name when available, e-mail otherwise. No address or phone is shown in the list. */
export function buyerLabel(order: AdminOrder) {
  return order.customer_name?.trim() || order.customer_email?.trim() || 'sin datos';
}

export function orderAmount(order: AdminOrder) {
  const value = Number(order.total_amount);
  return Number.isFinite(value) ? value : 0;
}

export function orderItemsLabel(order: AdminOrder) {
  if (!Array.isArray(order.order_items) || order.order_items.length === 0) return 'sin items';
  return order.order_items
    .map((entry) => {
      const item = (entry ?? {}) as { product_name?: unknown; quantity?: unknown };
      const name = typeof item.product_name === 'string' && item.product_name.trim() ? item.product_name.trim() : 'producto';
      const quantity = Number(item.quantity);
      return `${name} x${Number.isInteger(quantity) && quantity > 0 ? quantity : 1}`;
    })
    .join(', ');
}

export function formatOrderDate(value: string | null | undefined) {
  if (!value) return 'sin fecha';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'sin fecha';
  return new Intl.DateTimeFormat('es-AR', { dateStyle: 'short', timeStyle: 'short' }).format(date);
}
