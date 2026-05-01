import { Link } from 'react-router-dom';

import { Footer } from '../components/Footer';
import { usePaymentResult } from '../hooks/usePaymentResult';

type PaymentResultPageProps = {
  title: string;
  description: string;
  tone: 'success' | 'failure' | 'pending';
  actionLabel: string;
  actionTo: string;
};

const toneStyles = {
  success: {
    badge: 'border-emerald-200 bg-emerald-50 text-emerald-700',
    dot: 'bg-emerald-500',
    action: 'bg-slate-900 text-white hover:[background-color:var(--color-primary-dark)]',
  },
  failure: {
    badge: 'border-red-200 bg-red-50 text-red-700',
    dot: 'bg-red-500',
    action: 'bg-slate-900 text-white hover:[background-color:var(--color-primary-dark)]',
  },
  pending: {
    badge: 'border-amber-200 bg-amber-50 text-amber-700',
    dot: 'bg-amber-500',
    action: 'bg-slate-900 text-white hover:[background-color:var(--color-primary-dark)]',
  },
};

export function PaymentResultPage({ title, description, tone, actionLabel, actionTo }: PaymentResultPageProps) {
  const payment = usePaymentResult();
  const styles = toneStyles[tone];

  return (
    <div className="min-h-screen bg-white text-slate-900">
      <main className="px-4 py-14 sm:px-6 sm:py-16 lg:px-8 lg:py-20">
        <section className="mx-auto flex w-full max-w-3xl flex-col items-start">
          <div className={`inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-semibold ${styles.badge}`}>
            <span className={`h-2.5 w-2.5 rounded-full ${styles.dot}`} aria-hidden="true" />
            Mercado Pago
          </div>

          <h1 className="mt-6 text-4xl font-semibold tracking-tight text-slate-950 sm:text-5xl">{title}</h1>
          <p className="mt-4 max-w-2xl text-base leading-7 text-slate-600">{description}</p>

          <div className="mt-10 w-full rounded-2xl border border-slate-200 bg-stone-50 p-5 sm:p-6">
            <dl className="grid gap-4 text-sm sm:grid-cols-3">
              <PaymentDetail label="Payment ID" value={payment.paymentId} />
              <PaymentDetail label="Estado" value={payment.status} />
              <PaymentDetail label="Referencia" value={payment.externalReference} />
            </dl>
          </div>

          <div className="mt-8 flex w-full flex-col gap-3 sm:w-auto sm:flex-row">
            <Link
              to={actionTo}
              className={`inline-flex items-center justify-center rounded-full px-5 py-3 text-sm font-semibold transition ${styles.action}`}
            >
              {actionLabel}
            </Link>
            <Link
              to="/tienda"
              className="inline-flex items-center justify-center rounded-full border border-slate-300 px-5 py-3 text-sm font-semibold text-slate-700 transition hover:border-slate-900 hover:text-slate-950"
            >
              Ver tienda
            </Link>
          </div>
        </section>
      </main>
      <Footer />
    </div>
  );
}

function PaymentDetail({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">{label}</dt>
      <dd className="mt-2 break-words text-sm font-semibold text-slate-950">{value ?? 'No informado'}</dd>
    </div>
  );
}
