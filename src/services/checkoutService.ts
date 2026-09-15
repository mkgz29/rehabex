import type { CartItem } from '../cart/CartProvider';

export type CheckoutDetails = {
  customer: { email: string; name: string; phone?: string };
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
      items: cartItems.map((item) => ({ productId: item.productId, quantity: item.quantity })),
      customer: details.customer,
      delivery: details.delivery,
    }),
  });
  const data = await response.json().catch(() => null) as CheckoutResponse | null;
  if (!response.ok || !data?.checkoutUrl || !data.orderId || !data.statusToken) {
    throw new Error(data?.error ?? 'No se pudo iniciar el checkout.');
  }
  window.sessionStorage.setItem(`rehabex.order.${data.orderId}.status-token`, data.statusToken);
  window.sessionStorage.removeItem(IDEMPOTENCY_STORAGE_KEY);
  return data;
}

function getIdempotencyKey() {
  const existing = window.sessionStorage.getItem(IDEMPOTENCY_STORAGE_KEY);
  if (existing) return existing;
  const value = crypto.randomUUID();
  window.sessionStorage.setItem(IDEMPOTENCY_STORAGE_KEY, value);
  return value;
}
