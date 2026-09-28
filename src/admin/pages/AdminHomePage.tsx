import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

import { useAuth } from '../../auth/useAuth';
import { getProducts } from '../../services/cms';
import { AdminNotice } from '../components/AdminNotice';
import { AdminPageHeader } from '../components/AdminPageHeader';
import { buyerLabel, formatOrderDate, orderLabel, orderReference, type AdminOrder } from '../orderPresentation';
import { summarizeOrders, summarizeProducts } from '../summary';

type SummaryState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | {
      status: 'ready';
      visibleProducts: number;
      hiddenProducts: number;
      orderCount: number;
      ordersNeedingReview: number;
      recentOrders: AdminOrder[] | null;
    };

export function AdminHomePage() {
  const { session } = useAuth();
  const [state, setState] = useState<SummaryState>({ status: 'loading' });

  useEffect(() => {
    let mounted = true;

    async function load() {
      setState({ status: 'loading' });

      let visibleProducts = 0;
      let hiddenProducts = 0;
      try {
        const products = await getProducts();
        ({ visibleProducts, hiddenProducts } = summarizeProducts(products));
      } catch (loadError) {
        if (mounted) {
          setState({ status: 'error', message: loadError instanceof Error ? loadError.message : 'No se pudo cargar el resumen.' });
        }
        return;
      }

      // Orders go through the same admin-only endpoint as "Pedidos" -- never a
      // direct client query, since the orders table has no RLS of its own.
      let recentOrders: AdminOrder[] | null = null;
      let orderCount = 0;
      let ordersNeedingReview = 0;
      if (session?.access_token) {
        try {
          const response = await fetch('/api/orders', { headers: { Authorization: `Bearer ${session.access_token}` } });
          const payload = (await response.json()) as { orders?: AdminOrder[]; error?: string };
          if (response.ok && Array.isArray(payload.orders)) {
            const summary = summarizeOrders(payload.orders);
            orderCount = summary.orderCount;
            ordersNeedingReview = summary.ordersNeedingReview;
            recentOrders = summary.recentOrders;
          }
        } catch {
          // Pedidos no disponible ahora mismo: el resumen sigue mostrando lo que sí pudo cargar, sin inventar numeros de pedidos.
        }
      }

      if (mounted) {
        setState({ status: 'ready', visibleProducts, hiddenProducts, orderCount, ordersNeedingReview, recentOrders });
      }
    }

    load();
    return () => {
      mounted = false;
    };
  }, [session?.access_token]);

  return (
    <div className="space-y-6">
      <AdminPageHeader title="Resumen" description="Un vistazo rápido al estado de tu tienda." />

      {state.status === 'loading' ? (
        <div aria-busy="true" className="rounded-[2rem] border border-slate-200 bg-stone-50 p-5 text-sm text-slate-600">
          Cargando resumen...
        </div>
      ) : null}

      {state.status === 'error' ? <AdminNotice>{state.message}</AdminNotice> : null}

      {state.status === 'ready' ? (
        <>
          <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4" aria-label="Números de la tienda">
            <SummaryCard label="Productos visibles" value={state.visibleProducts} />
            <SummaryCard label="Productos ocultos" value={state.hiddenProducts} />
            <SummaryCard label="Pedidos" value={state.orderCount} />
            <SummaryCard
              label="Pedidos que requieren revisión"
              value={state.ordersNeedingReview}
              emphasis={state.ordersNeedingReview > 0}
            />
          </section>

          <section className="rounded-[2rem] border border-slate-200 bg-stone-50 p-5">
            <h3 className="text-lg font-semibold text-slate-900">Accesos rápidos</h3>
            <div className="mt-4 flex flex-wrap gap-3">
              <QuickLink to="/admin/productos" label="Agregar producto" />
              <QuickLink to="/admin/pagina" label="Editar página" />
              <QuickLink to="/admin/pedidos" label="Ver pedidos" />
            </div>
          </section>

          {state.recentOrders ? (
            <section className="rounded-[2rem] border border-slate-200 bg-stone-50 p-5">
              <h3 className="text-lg font-semibold text-slate-900">Pedidos recientes</h3>
              {state.recentOrders.length === 0 ? (
                <p className="mt-3 text-sm text-slate-600">Todavía no hay pedidos.</p>
              ) : (
                <ul className="mt-4 divide-y divide-slate-200">
                  {state.recentOrders.map((order) => (
                    <li key={order.id ?? orderReference(order)} className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm">
                      <span className="font-mono text-xs font-semibold text-slate-900">{orderReference(order)}</span>
                      <span className="text-slate-700">{buyerLabel(order)}</span>
                      <span className="text-slate-600">{orderLabel(order)}</span>
                      <span className="text-slate-500">{formatOrderDate(order.created_at)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

function SummaryCard({ label, value, emphasis }: { label: string; value: number; emphasis?: boolean }) {
  return (
    <div
      className={`rounded-2xl border p-4 ${emphasis ? 'border-red-200 bg-red-50' : 'border-slate-200 bg-white'}`}
    >
      <p className="text-sm text-slate-600">{label}</p>
      <p className={`mt-1 text-3xl font-semibold ${emphasis ? 'text-red-700' : 'text-slate-950'}`}>{value}</p>
    </div>
  );
}

function QuickLink({ to, label }: { to: string; label: string }) {
  return (
    <Link
      to={to}
      className="inline-flex min-h-11 items-center rounded-full border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-slate-900 hover:bg-white"
    >
      {label}
    </Link>
  );
}
