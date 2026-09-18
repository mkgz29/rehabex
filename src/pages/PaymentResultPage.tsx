import { useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';

import { useCart } from '../cart/useCart';
import { Footer } from '../components/Footer';
import { usePaymentResult } from '../hooks/usePaymentResult';
import { recoveryNotice } from '../services/paymentMessages';

const content = {
  verifying: { title: 'Verificando el estado de tu pago', description: 'Estamos consultando la confirmacion registrada por el servidor. No usamos los parametros del redirect como prueba de pago.', tone: 'pending', action: 'Actualizar estado', actionTo: '/carrito' },
  approved: { title: 'Pago confirmado', description: 'El servidor confirmo el pago. Actualizamos solamente los productos incluidos en esta compra.', tone: 'success', action: 'Volver a la tienda', actionTo: '/tienda' },
  pending: { title: 'Pago pendiente', description: 'Todavia no hay una confirmacion final registrada. Conservamos tu carrito mientras esperas o vuelves a consultar.', tone: 'pending', action: 'Volver al carrito', actionTo: '/carrito' },
  rejected: { title: 'Pago no confirmado', description: 'El servidor registro un rechazo o cancelacion. Conservamos tu carrito para que puedas intentar nuevamente.', tone: 'failure', action: 'Volver al carrito', actionTo: '/carrito' },
  expired: { title: 'El checkout venció', description: 'La reserva de esta compra vencio sin un pago confirmado. Podes armar el pedido nuevamente desde el carrito. Si Mercado Pago aprueba el pago mas tarde, el servidor lo registra igual y te contactamos.', tone: 'failure', action: 'Volver al carrito', actionTo: '/carrito' },
  unknown: { title: 'No pudimos verificar el pago', description: 'No afirmamos que el pago este aprobado. Conservamos el carrito y el contexto para que puedas volver a consultar.', tone: 'failure', action: 'Volver al carrito', actionTo: '/carrito' },
} as const;

const toneStyles = {
  success: { badge: 'border-emerald-200 bg-emerald-50 text-emerald-700', dot: 'bg-emerald-500' },
  failure: { badge: 'border-red-200 bg-red-50 text-red-700', dot: 'bg-red-500' },
  pending: { badge: 'border-amber-200 bg-amber-50 text-amber-700', dot: 'bg-amber-500' },
};

export function PaymentResultPage() {
  const { confirmCheckout, releaseCheckout } = useCart();
  const payment = usePaymentResult();
  const handled = useRef<string | null>(null);

  useEffect(() => {
    if (!payment.snapshot || handled.current === payment.snapshot.orderId) return;
    if (payment.state === 'approved') {
      handled.current = payment.snapshot.orderId;
      confirmCheckout(payment.snapshot);
    }
    // A rejected or expired checkout must free the locked cart lines so the
    // buyer can retry. Stock itself is only ever moved by the atomic processor.
    if (payment.state === 'rejected' || payment.state === 'expired') {
      handled.current = payment.snapshot.orderId;
      releaseCheckout(payment.snapshot);
    }
  }, [confirmCheckout, payment.snapshot, payment.state, releaseCheckout]);

  const view = content[payment.state];
  const styles = toneStyles[view.tone];
  const notice = recoveryNotice(payment.recovery, payment.retryAfterSeconds);
  return (
    <div className="min-h-screen bg-white text-slate-900">
      <main className="px-4 py-14 sm:px-6 sm:py-16 lg:px-8 lg:py-20">
        <section className="mx-auto flex w-full max-w-3xl flex-col items-start">
          <div className={`inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-semibold ${styles.badge}`}>
            <span className={`h-2.5 w-2.5 rounded-full ${styles.dot}`} aria-hidden="true" /> Mercado Pago
          </div>
          <h1 className="mt-6 text-4xl font-semibold tracking-tight text-slate-950 sm:text-5xl">{view.title}</h1>
          <p className="mt-4 max-w-2xl text-base leading-7 text-slate-600">{view.description}</p>
          {notice ? <p className="mt-4 max-w-2xl rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm leading-6 text-slate-700">{notice}</p> : null}
          <p className="mt-5 text-sm text-slate-500">La confirmacion se obtiene desde el backend autenticado; payment_id, status y external_reference de la URL no cambian este resultado.</p>
          <div className="mt-8 flex w-full flex-col gap-3 sm:w-auto sm:flex-row">
            <Link to={view.actionTo} className="inline-flex items-center justify-center rounded-full bg-slate-900 px-5 py-3 text-sm font-semibold text-white transition hover:[background-color:var(--color-primary-dark)]">{view.action}</Link>
            <button type="button" onClick={payment.refresh} disabled={payment.state === 'verifying'} className="inline-flex items-center justify-center rounded-full border border-slate-300 px-5 py-3 text-sm font-semibold text-slate-700 transition hover:border-slate-900 hover:text-slate-950 disabled:cursor-not-allowed disabled:opacity-60">Consultar nuevamente</button>
          </div>
        </section>
      </main>
      <Footer />
    </div>
  );
}
