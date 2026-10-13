// FASE 7F-B4. Pure presentation logic for the public tracking page: which
// steps to show (pickup vs delivery) and which are already done, given only
// the order's current fulfillment_status. No network, no DOM.
export type FulfillmentStep = { status: string; label: string; done: boolean };

const PICKUP_SEQUENCE = ['not_started', 'preparing', 'ready_for_pickup', 'delivered'] as const;
const DELIVERY_SEQUENCE = ['not_started', 'preparing', 'shipped', 'delivered'] as const;

const STEP_LABELS: Record<string, string> = {
  not_started: 'Pago confirmado',
  preparing: 'Preparando pedido',
  ready_for_pickup: 'Listo para retirar',
  shipped: 'Despachado',
  delivered: 'Entregado',
};

/** Null fulfillmentStatus (an order whose payment was never approved) and 'cancelled' both return an empty list -- the caller shows a distinct message instead of a timeline. */
export function buildFulfillmentSteps(deliveryMethod: string | null, fulfillmentStatus: string | null): FulfillmentStep[] {
  if (!fulfillmentStatus || fulfillmentStatus === 'cancelled' || fulfillmentStatus === 'returned') return [];
  const sequence: readonly string[] = deliveryMethod === 'pickup' ? PICKUP_SEQUENCE : DELIVERY_SEQUENCE;
  const currentIndex = sequence.indexOf(fulfillmentStatus);
  if (currentIndex === -1) return [];
  return sequence.map((status, index) => ({ status, label: STEP_LABELS[status] ?? status, done: index <= currentIndex }));
}
