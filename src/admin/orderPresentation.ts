export type OrderFulfillmentEvent = {
  from_status: string | null;
  to_status: string;
  note: string | null;
  created_at: string;
};

/** Contract returned by /api/orders. Mirrors the explicit projection there. The detail-only fields (delivery_*, pickup_*, order_fulfillment_events) are only present on a single-order fetch (?id=), never on the list. */
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
  customer_phone?: string | null;
  mercadopago_payment_id?: string | null;
  mercadopago_preference_id?: string | null;
  review_required?: boolean | null;
  review_reason?: string | null;
  refund_required?: boolean | null;
  order_items?: unknown;
  delivery_recipient_name?: string | null;
  delivery_phone?: string | null;
  delivery_address_line1?: string | null;
  delivery_address_line2?: string | null;
  delivery_city?: string | null;
  delivery_province?: string | null;
  delivery_postal_code?: string | null;
  delivery_notes?: string | null;
  pickup_location_label?: string | null;
  pickup_window?: string | null;
  order_fulfillment_events?: OrderFulfillmentEvent[] | null;
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

// Exhaustive translations of the real Postgres enums (payment_status,
// order_status -- supabase/migrations/202609110103_orders_commerce_foundation.sql).
// Anything not in these maps (there should be nothing, since Postgres enforces
// the enum) falls back to "Estado sin identificar" rather than ever leaking a
// raw technical value to a non-technical admin.
export const PAYMENT_STATUS_LABELS: Record<string, string> = {
  unpaid: 'Pago pendiente',
  pending: 'Pago en proceso',
  approved: 'Pago aprobado',
  rejected: 'Pago rechazado',
  cancelled: 'Pago cancelado',
  refunded: 'Pago reembolsado',
  charged_back: 'Contracargo',
};

export const FULFILLMENT_STATUS_LABELS: Record<string, string> = {
  not_started: 'Sin iniciar',
  preparing: 'En preparación',
  ready_for_pickup: 'Listo para retirar',
  shipped: 'Enviado',
  delivered: 'Entregado',
  cancelled: 'Cancelado',
  returned: 'Devuelto',
};

export const ORDER_STATUS_LABELS: Record<string, string> = {
  draft: 'Borrador',
  pending_payment: 'Esperando el pago',
  confirmed: 'Confirmado',
  on_hold: 'En revisión',
  cancelled: 'Cancelado',
  completed: 'Completado',
  expired: 'Vencido',
  refunded: 'Reembolsado',
  failed: 'Fallido',
};

const UNKNOWN_STATUS_LABEL = 'Estado sin identificar';

export function paymentLabel(order: AdminOrder) {
  const status = order.payment_status?.trim();
  if (!status) return UNKNOWN_STATUS_LABEL;
  return PAYMENT_STATUS_LABELS[status] ?? UNKNOWN_STATUS_LABEL;
}

export function orderLabel(order: AdminOrder) {
  const status = order.order_status?.trim();
  if (!status) return UNKNOWN_STATUS_LABEL;
  return ORDER_STATUS_LABELS[status] ?? UNKNOWN_STATUS_LABEL;
}

export function fulfillmentLabel(order: AdminOrder) {
  const status = order.fulfillment_status?.trim();
  if (!status) return UNKNOWN_STATUS_LABEL;
  return FULFILLMENT_STATUS_LABELS[status] ?? UNKNOWN_STATUS_LABEL;
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

// --- Fulfillment state machine (FASE 7F-B4) -----------------------------------
//
// Mirrors admin_update_order_fulfillment_status's own CASE exactly, only to
// decide which buttons to show -- the RPC is the real authority and
// re-validates every transition itself; a mismatch here only hides or shows
// a button, it can never let an invalid change through.

export type FulfillmentTransition = 'preparing' | 'ready_for_pickup' | 'shipped' | 'delivered' | 'cancelled';

export const FULFILLMENT_TRANSITION_LABELS: Record<FulfillmentTransition, string> = {
  preparing: 'Marcar en preparación',
  ready_for_pickup: 'Listo para retirar',
  shipped: 'Marcar despachado',
  delivered: 'Marcar entregado',
  cancelled: 'Cancelar pedido',
};

export function nextFulfillmentTransitions(order: AdminOrder): FulfillmentTransition[] {
  if (order.order_status !== 'confirmed') return [];
  const current = order.fulfillment_status ?? 'not_started';
  const isPickup = order.delivery_method === 'pickup';
  switch (current) {
    case 'not_started':
      return ['preparing', 'cancelled'];
    case 'preparing':
      return isPickup ? ['ready_for_pickup', 'cancelled'] : ['shipped', 'cancelled'];
    case 'ready_for_pickup':
    case 'shipped':
      return ['delivered', 'cancelled'];
    default:
      return [];
  }
}

export function formatOrderDate(value: string | null | undefined) {
  if (!value) return 'sin fecha';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'sin fecha';
  return new Intl.DateTimeFormat('es-AR', { dateStyle: 'short', timeStyle: 'short' }).format(date);
}
