import type { CartItem } from '../cart/CartProvider';
import { createCheckoutSnapshot, persistCheckoutSnapshot } from '../cart/checkoutSnapshot';

export type CheckoutDetails = {
  customer: { email: string; name: string; phone: string };
  delivery: {
    method: 'pickup' | 'delivery';
    recipientName?: string;
    phone?: string;
    addressLine1?: string;
    addressLine2?: string;
    city?: string;
    province?: string;
    postalCode?: string;
    notes?: string;
    pickupLocationLabel?: string;
    pickupWindow?: string;
  };
};

type CheckoutResponse = { checkoutUrl: string; orderId: string; statusToken: string; error?: string };
const IDEMPOTENCY_STORAGE_KEY = 'rehabex.checkout.idempotency';

export async function createSecureCheckout(cartItems: CartItem[], details: CheckoutDetails) {
  const idempotencyKey = getIdempotencyKey();
  const response = await fetch('/api/checkout', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
    body: JSON.stringify({
      items: checkoutItemsForRequest(cartItems),
      customer: details.customer,
      delivery: details.delivery,
    }),
  });
  const data = await response.json().catch(() => null) as CheckoutResponse | null;
  if (!response.ok || !data?.checkoutUrl || !data.orderId || !data.statusToken) {
    throw new Error(data?.error ?? 'No se pudo iniciar el checkout.');
  }
  const snapshot = createCheckoutSnapshot(data.orderId, data.statusToken, cartItems);
  if (!snapshot) throw new Error('No se pudo guardar el contexto seguro del checkout. Reintenta antes de continuar.');
  try {
    persistCheckoutSnapshot(window.sessionStorage, window.localStorage, snapshot);
  } catch {
    throw new Error('No se pudo guardar el contexto seguro del checkout. Reintenta antes de continuar.');
  }
  window.sessionStorage.removeItem(IDEMPOTENCY_STORAGE_KEY);
  return data;
}

/** The backend resolves product price and stock; browser snapshots never cross this boundary. */
export function checkoutItemsForRequest(cartItems: CartItem[]) {
  const quantities = new Map<string, number>();
  for (const item of cartItems) quantities.set(item.productId, (quantities.get(item.productId) ?? 0) + item.quantity);
  return [...quantities].map(([productId, quantity]) => ({ productId, quantity }));
}

function getIdempotencyKey() {
  const existing = window.sessionStorage.getItem(IDEMPOTENCY_STORAGE_KEY);
  if (existing) return existing;
  const value = crypto.randomUUID();
  window.sessionStorage.setItem(IDEMPOTENCY_STORAGE_KEY, value);
  return value;
}
