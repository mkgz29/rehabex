import { useEffect, useState } from 'react';

import { buildFulfillmentSteps } from '../lib/fulfillmentTimeline';
import { parseOrderTrackingFragment } from '../lib/orderTrackingLink';
import { requestOrderTracking, type OrderTrackingRecord } from '../services/orderStatusService';

type PageState =
  | { kind: 'loading' }
  | { kind: 'invalid_link' }
  | { kind: 'not_found' }
  | { kind: 'ready'; order: OrderTrackingRecord };

/**
 * Public, no-account tracking page. The order id + token come ONLY from the
 * URL fragment (window.location.hash) -- never a query string, never
 * sessionStorage (that's the live-checkout-tab path, SuccessPage/PendingPage
 * already cover it). The backend is always the authority on status; nothing
 * here is trusted from a query param.
 */
export function MyOrderPage() {
  const [state, setState] = useState<PageState>({ kind: 'loading' });

  useEffect(() => {
    const parsed = parseOrderTrackingFragment(window.location.hash);
    if (!parsed) {
      setState({ kind: 'invalid_link' });
      return;
    }
    let active = true;
    requestOrderTracking(parsed.orderId, parsed.token).then((result) => {
      if (!active) return;
      setState(result.ok ? { kind: 'ready', order: result.order } : { kind: 'not_found' });
    });
    return () => { active = false; };
  }, []);

  if (state.kind === 'loading') {
    return (
      <main className="site-container py-16 text-center text-sm text-muted" aria-busy="true">
        Buscando tu pedido...
      </main>
    );
  }

  if (state.kind === 'invalid_link' || state.kind === 'not_found') {
    return (
      <main className="site-container py-16 text-center">
        <p className="text-base font-semibold text-ink">No pudimos encontrar tu pedido.</p>
        <p className="mt-2 text-sm text-muted">Revisá el link de tu email de confirmación, o escribinos desde /soporte si necesitás ayuda.</p>
      </main>
    );
  }

  const { order } = state;

  return (
    <main className="site-container py-16">
      <div className="mx-auto max-w-lg">
        <p className="text-xs font-bold uppercase tracking-[0.2em] text-accent">Pedido {order.order_number}</p>
        <h1 className="mt-3 text-2xl font-bold text-ink">Seguimiento de tu compra</h1>

        {order.payment_status !== 'approved' || order.order_status !== 'confirmed' ? (
          <p className="mt-6 text-sm text-muted">
            {order.order_status === 'cancelled' || order.payment_status === 'rejected'
              ? 'Este pedido fue cancelado.'
              : 'Todavía estamos confirmando tu pago. Actualizá esta página en unos minutos.'}
          </p>
        ) : order.fulfillment_status === 'cancelled' ? (
          <p className="mt-6 text-sm text-muted">Este pedido fue cancelado.</p>
        ) : (
          <ol className="mt-8 space-y-4">
            {buildFulfillmentSteps(order.delivery_method, order.fulfillment_status).map((step) => (
              <li key={step.status} className="flex items-center gap-3">
                <span
                  aria-hidden="true"
                  className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-xs font-bold ${
                    step.done ? 'border-primary bg-primary text-white' : 'border-line text-muted'
                  }`}
                >
                  {step.done ? '✓' : ''}
                </span>
                <span className={step.done ? 'font-medium text-ink' : 'text-muted'}>{step.label}</span>
              </li>
            ))}
          </ol>
        )}
      </div>
    </main>
  );
}
