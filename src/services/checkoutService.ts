import type { CartItem } from '../cart/CartProvider';

type CheckoutPreferenceResponse = {
  checkoutUrl: string;
};

type CheckoutItem = {
  id: string;
  name: string;
  quantity: number;
  unit_price: number;
};

export async function createCheckoutPreference(cartItems: CartItem[]) {
  const items: CheckoutItem[] = cartItems.map((item) => ({
    id: item.id,
    name: item.name,
    quantity: item.quantity,
    unit_price: item.price,
  }));

  const response = await fetch('/api/create-preference', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ items }),
  });

  const data = (await response.json().catch(() => null)) as Partial<CheckoutPreferenceResponse> & {
    error?: string;
  } | null;

  if (!response.ok) {
    throw new Error(data?.error ?? 'No se pudo iniciar el checkout.');
  }

  if (!data?.checkoutUrl) {
    throw new Error('Mercado Pago no devolvio una URL de checkout.');
  }

  return data.checkoutUrl;
}
