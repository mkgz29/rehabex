import { useState } from 'react';
import { Link } from 'react-router-dom';

import { Footer } from '../components/Footer';
import { useCart } from '../cart/useCart';
import { formatCurrency } from '../lib/format';
import { createSecureCheckout } from '../services/checkoutService';

export function CartPage() {
  const { clearCart, decreaseQuantity, increaseQuantity, isLineLocked, items, removeItem, totalItems, totalPrice } = useCart();
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);
  const [customerName, setCustomerName] = useState('');
  const [customerEmail, setCustomerEmail] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [deliveryMethod, setDeliveryMethod] = useState<'pickup' | 'delivery'>('pickup');
  const [recipientName, setRecipientName] = useState('');
  const [addressLine1, setAddressLine1] = useState('');
  const [city, setCity] = useState('');
  const [province, setProvince] = useState('');
  const [postalCode, setPostalCode] = useState('');
  const [deliveryNotes, setDeliveryNotes] = useState('');

  const handleCheckout = async () => {
    if (items.length === 0 || checkoutLoading) {
      return;
    }

    setCheckoutLoading(true);
    setCheckoutError(null);

    try {
      const { checkoutUrl } = await createSecureCheckout(items, {
        customer: { name: customerName.trim(), email: customerEmail.trim(), phone: customerPhone.trim() },
        delivery: deliveryMethod === 'pickup'
          ? { method: 'pickup' }
          : { method: 'delivery', recipientName: recipientName.trim(), phone: customerPhone.trim(), addressLine1: addressLine1.trim(), city: city.trim(), province: province.trim(), postalCode: postalCode.trim(), ...(deliveryNotes.trim() ? { notes: deliveryNotes.trim() } : {}) },
      });
      window.location.assign(checkoutUrl);
    } catch (error) {
      setCheckoutError(error instanceof Error ? error.message : 'No se pudo iniciar el checkout.');
      setCheckoutLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-white text-slate-900">
      <main className="px-4 py-14 sm:px-6 sm:py-16 lg:px-8 lg:py-20">
        <section className="mx-auto w-full max-w-7xl">
          <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.34em] text-slate-500">Compra local</p>
              <h1 className="mt-4 text-4xl font-semibold tracking-tight text-slate-950 sm:text-5xl">Carrito</h1>
            </div>
            <Link to="/tienda" className="brand-link inline-flex text-sm font-semibold">
              Continuar comprando
            </Link>
          </div>

          {items.length === 0 ? (
            <div className="mt-12 rounded-2xl border border-slate-200 bg-stone-50 p-6">
              <h2 className="text-2xl font-semibold tracking-tight text-slate-950">Tu carrito esta vacio</h2>
              <p className="mt-3 text-sm leading-6 text-slate-600">Agrega productos desde la tienda para verlos aca.</p>
              <Link
                to="/tienda"
                className="mt-6 inline-flex items-center justify-center rounded-full bg-slate-900 px-5 py-3 text-sm font-semibold text-white transition hover:[background-color:var(--color-primary-dark)]"
              >
                Ir a tienda
              </Link>
            </div>
          ) : (
            <div className="mt-12 grid gap-8 lg:grid-cols-[minmax(0,1fr)_360px]">
              <div className="space-y-4">
                {items.map((item) => (
                  <article key={item.lineId} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                    <div className="grid gap-4 sm:grid-cols-[96px_minmax(0,1fr)] sm:items-center">
                      {item.imageUrl ? (
                        <img src={item.imageUrl} alt={item.name} className="h-24 w-24 rounded-2xl object-cover object-center" />
                      ) : <div className="flex h-24 w-24 items-center justify-center rounded-2xl bg-slate-100 text-xs text-slate-500">Sin imagen</div>}
                      <div className="min-w-0">
                        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                          <div>
                            <h2 className="text-lg font-semibold text-slate-950">{item.name}</h2>
                            <p className="mt-1 text-sm text-slate-600">Precio unitario: {formatCurrency(item.price)}</p>
                            <p className="mt-1 text-sm font-semibold text-slate-900">
                              Subtotal: {formatCurrency(item.price * item.quantity)}
                            </p>
                            {item.availableStock !== undefined ? <p className="mt-1 text-sm text-slate-600">Stock visible: {item.availableStock}</p> : null}
                            {isLineLocked(item.lineId) ? <p className="mt-1 text-sm font-medium text-amber-700">Pendiente de confirmacion del pago</p> : null}
                          </div>

                          <div className="flex flex-wrap items-center gap-2">
                            <button
                              type="button"
                              onClick={() => decreaseQuantity(item.lineId)}
                              className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-slate-300 text-lg font-semibold text-slate-700 transition hover:border-slate-900"
                              aria-label={`Restar ${item.name}`}
                              disabled={isLineLocked(item.lineId)}
                            >
                              -
                            </button>
                            <span className="inline-flex min-w-10 justify-center text-sm font-semibold text-slate-900">
                              {item.quantity}
                            </span>
                            <button
                              type="button"
                              onClick={() => increaseQuantity(item.lineId)}
                              className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-slate-300 text-lg font-semibold text-slate-700 transition hover:border-slate-900"
                              aria-label={`Sumar ${item.name}`}
                              disabled={isLineLocked(item.lineId) || (item.availableStock !== undefined && item.quantity >= item.availableStock)}
                            >
                              +
                            </button>
                            <button
                              type="button"
                              onClick={() => removeItem(item.lineId)}
                              className="rounded-full border border-red-200 px-4 py-2 text-sm font-semibold text-red-600 transition hover:bg-red-50"
                              disabled={isLineLocked(item.lineId)}
                            >
                              Eliminar
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  </article>
                ))}
              </div>

              <aside className="h-fit rounded-2xl border border-slate-200 bg-stone-50 p-5">
                <h2 className="text-xl font-semibold tracking-tight text-slate-950">Resumen</h2>
                <div className="mt-5 space-y-3 text-sm text-slate-700">
                  <div className="flex items-center justify-between">
                    <span>Productos</span>
                    <span className="font-semibold text-slate-950">{totalItems}</span>
                  </div>
                  <div className="flex items-center justify-between border-t border-slate-200 pt-3 text-base">
                    <span>Total</span>
                    <span className="font-semibold text-slate-950">{formatCurrency(totalPrice)}</span>
                  </div>
                </div>
                <p className="mt-4 text-xs leading-5 text-slate-600">El precio y la disponibilidad definitivos se recalculan en el servidor al iniciar el checkout.</p>

                <div className="mt-5 space-y-3 border-t border-slate-200 pt-4 text-sm">
                  <input value={customerName} onChange={(event) => setCustomerName(event.target.value)} placeholder="Nombre y apellido" autoComplete="name" className="w-full rounded-lg border border-slate-300 px-3 py-2" />
                  <input value={customerEmail} onChange={(event) => setCustomerEmail(event.target.value)} placeholder="Email" type="email" autoComplete="email" className="w-full rounded-lg border border-slate-300 px-3 py-2" />
                  <input value={customerPhone} onChange={(event) => setCustomerPhone(event.target.value)} placeholder="Telefono" type="tel" autoComplete="tel" required className="w-full rounded-lg border border-slate-300 px-3 py-2" />
                  <label className="flex items-center gap-2"><input type="radio" checked={deliveryMethod === 'pickup'} onChange={() => setDeliveryMethod('pickup')} /> Retiro</label>
                  <label className="flex items-center gap-2"><input type="radio" checked={deliveryMethod === 'delivery'} onChange={() => setDeliveryMethod('delivery')} /> Envío</label>
                  {deliveryMethod === 'delivery' ? (
                    <div className="space-y-3">
                      <input value={recipientName} onChange={(event) => setRecipientName(event.target.value)} placeholder="Destinatario" autoComplete="shipping name" className="w-full rounded-lg border border-slate-300 px-3 py-2" />
                      <input value={addressLine1} onChange={(event) => setAddressLine1(event.target.value)} placeholder="Dirección" autoComplete="street-address" className="w-full rounded-lg border border-slate-300 px-3 py-2" />
                      <input value={city} onChange={(event) => setCity(event.target.value)} placeholder="Ciudad" autoComplete="address-level2" className="w-full rounded-lg border border-slate-300 px-3 py-2" />
                      <input value={province} onChange={(event) => setProvince(event.target.value)} placeholder="Provincia" autoComplete="address-level1" className="w-full rounded-lg border border-slate-300 px-3 py-2" />
                      <input value={postalCode} onChange={(event) => setPostalCode(event.target.value)} placeholder="Código postal" autoComplete="postal-code" className="w-full rounded-lg border border-slate-300 px-3 py-2" />
                      <input value={deliveryNotes} onChange={(event) => setDeliveryNotes(event.target.value)} placeholder="Referencias (opcional)" autoComplete="off" className="w-full rounded-lg border border-slate-300 px-3 py-2" />
                    </div>
                  ) : null}
                </div>

                <button
                  type="button"
                  className="mt-6 inline-flex w-full items-center justify-center rounded-full bg-slate-900 px-5 py-3 text-sm font-semibold text-white transition hover:[background-color:var(--color-primary-dark)] disabled:cursor-not-allowed disabled:opacity-60"
                  onClick={handleCheckout}
                  disabled={items.length === 0 || checkoutLoading || !customerName.trim() || !isValidEmail(customerEmail) || !customerPhone.trim() || (deliveryMethod === 'delivery' && (!recipientName.trim() || !addressLine1.trim() || !city.trim() || !province.trim() || !postalCode.trim()))}
                >
                  {checkoutLoading ? 'Creando checkout...' : 'Comprar'}
                </button>

                {checkoutError ? <p className="mt-3 text-sm text-red-600">{checkoutError}</p> : null}

                <button
                  type="button"
                  className="mt-3 inline-flex w-full items-center justify-center rounded-full border border-red-200 px-5 py-3 text-sm font-semibold text-red-600 transition hover:bg-red-50"
                  onClick={clearCart}
                >
                  Vaciar carrito no pendiente
                </button>
              </aside>
            </div>
          )}
        </section>
      </main>
      <Footer />
    </div>
  );
}

function isValidEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}
