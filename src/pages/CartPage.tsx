import { useState } from 'react';
import { Link } from 'react-router-dom';

import { Footer } from '../components/Footer';
import { useCart } from '../cart/useCart';
import { formatCurrency } from '../lib/format';
import { createCheckoutPreference } from '../services/checkoutService';

export function CartPage() {
  const { clearCart, decreaseQuantity, increaseQuantity, items, removeItem, totalItems, totalPrice } = useCart();
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);

  const handleCheckout = async () => {
    if (items.length === 0 || checkoutLoading) {
      return;
    }

    setCheckoutLoading(true);
    setCheckoutError(null);

    try {
      const checkoutUrl = await createCheckoutPreference(items);
      window.location.href = checkoutUrl;
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
                  <article key={item.productId} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                    <div className="grid gap-4 sm:grid-cols-[96px_minmax(0,1fr)] sm:items-center">
                      <img
                        src={item.imageUrl}
                        alt={item.name}
                        className="h-24 w-24 rounded-2xl object-cover object-center"
                      />
                      <div className="min-w-0">
                        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                          <div>
                            <h2 className="text-lg font-semibold text-slate-950">{item.name}</h2>
                            <p className="mt-1 text-sm text-slate-600">Precio unitario: {formatCurrency(item.price)}</p>
                            <p className="mt-1 text-sm font-semibold text-slate-900">
                              Subtotal: {formatCurrency(item.price * item.quantity)}
                            </p>
                          </div>

                          <div className="flex flex-wrap items-center gap-2">
                            <button
                              type="button"
                              onClick={() => decreaseQuantity(item.productId)}
                              className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-slate-300 text-lg font-semibold text-slate-700 transition hover:border-slate-900"
                              aria-label={`Restar ${item.name}`}
                            >
                              -
                            </button>
                            <span className="inline-flex min-w-10 justify-center text-sm font-semibold text-slate-900">
                              {item.quantity}
                            </span>
                            <button
                              type="button"
                              onClick={() => increaseQuantity(item.productId)}
                              className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-slate-300 text-lg font-semibold text-slate-700 transition hover:border-slate-900"
                              aria-label={`Sumar ${item.name}`}
                            >
                              +
                            </button>
                            <button
                              type="button"
                              onClick={() => removeItem(item.productId)}
                              className="rounded-full border border-red-200 px-4 py-2 text-sm font-semibold text-red-600 transition hover:bg-red-50"
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

                <button
                  type="button"
                  className="mt-6 inline-flex w-full items-center justify-center rounded-full bg-slate-900 px-5 py-3 text-sm font-semibold text-white transition hover:[background-color:var(--color-primary-dark)] disabled:cursor-not-allowed disabled:opacity-60"
                  onClick={handleCheckout}
                  disabled={items.length === 0 || checkoutLoading}
                >
                  {checkoutLoading ? 'Creando checkout...' : 'Comprar'}
                </button>

                {checkoutError ? <p className="mt-3 text-sm text-red-600">{checkoutError}</p> : null}

                <button
                  type="button"
                  className="mt-3 inline-flex w-full items-center justify-center rounded-full border border-red-200 px-5 py-3 text-sm font-semibold text-red-600 transition hover:bg-red-50"
                  onClick={clearCart}
                >
                  Vaciar carrito
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
