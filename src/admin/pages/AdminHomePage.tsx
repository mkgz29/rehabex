import { useEffect, useMemo, useState } from 'react';
import {
  ArrowRight,
  CircleDollarSign,
  ClipboardCheck,
  Clock3,
  PackagePlus,
  PencilLine,
  ReceiptText,
  ShoppingBag,
  TriangleAlert,
  type LucideIcon,
} from 'lucide-react';
import { Link } from 'react-router-dom';

import { useAuth } from '../../auth/useAuth';
import { formatCurrency } from '../../lib/format';
import { getProducts } from '../../services/cms';
import type { Product } from '../../types/cms';
import { AdminNotice } from '../components/AdminNotice';
import { SalesTrendChart } from '../components/SalesTrendChart';
import { TopProductsCard } from '../components/TopProductsCard';
import {
  buildDailySalesSeries,
  summarizePeriodSales,
  summarizeTopProducts,
  type DashboardPeriod,
} from '../dashboardAnalytics';
import { buyerLabel, formatOrderDate, orderAmount, orderLabel, orderReference, type AdminOrder } from '../orderPresentation';
import { LOW_STOCK_THRESHOLD, summarizeBusinessDashboard, type BusinessDashboardSummary } from '../summary';

type SummaryState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; products: Product[]; orders: AdminOrder[]; ordersAvailable: boolean };

export function AdminHomePage() {
  const { session } = useAuth();
  const [state, setState] = useState<SummaryState>({ status: 'loading' });

  useEffect(() => {
    let mounted = true;

    async function load() {
      setState({ status: 'loading' });

      let products;
      try {
        products = await getProducts();
      } catch (loadError) {
        if (mounted) {
          setState({ status: 'error', message: loadError instanceof Error ? loadError.message : 'No se pudo cargar el resumen.' });
        }
        return;
      }

      // Orders go through the existing admin-only endpoint. A failed order
      // request remains visibly unavailable instead of being presented as zero.
      let orders: AdminOrder[] | null = null;
      if (session?.access_token) {
        try {
          const response = await fetch('/api/orders', { headers: { Authorization: `Bearer ${session.access_token}` } });
          const payload = (await response.json()) as { orders?: AdminOrder[]; error?: string };
          if (response.ok && Array.isArray(payload.orders)) orders = payload.orders;
        } catch {
          // Product information remains useful even when orders are temporarily unavailable.
        }
      }

      if (mounted) {
        setState({
          status: 'ready',
          products,
          orders: orders ?? [],
          ordersAvailable: orders !== null,
        });
      }
    }

    load();
    return () => {
      mounted = false;
    };
  }, [session?.access_token]);

  return (
    <div className="space-y-6">
      <header className="border-b border-slate-200 pb-6">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h2 className="text-2xl font-semibold tracking-tight text-slate-950">Resumen</h2>
            <p className="mt-2 text-sm leading-6 text-slate-600">Estado general de tu tienda.</p>
          </div>
          <nav className="flex flex-wrap gap-2" aria-label="Acciones rápidas">
            <QuickLink to="/admin/productos" label="Agregar producto" icon={PackagePlus} />
            <QuickLink to="/admin/pedidos" label="Ver pedidos" icon={ShoppingBag} />
            <QuickLink to="/admin/pagina" label="Editar página" icon={PencilLine} />
          </nav>
        </div>
      </header>

      {state.status === 'loading' ? (
        <div aria-busy="true" className="rounded-[2rem] border border-slate-200 bg-stone-50 p-5 text-sm text-slate-600">
          Cargando resumen...
        </div>
      ) : null}

      {state.status === 'error' ? <AdminNotice>{state.message}</AdminNotice> : null}

      {state.status === 'ready' ? (
        <DashboardContent products={state.products} orders={state.orders} ordersAvailable={state.ordersAvailable} />
      ) : null}
    </div>
  );
}

function DashboardContent({
  products,
  orders,
  ordersAvailable,
}: {
  products: Product[];
  orders: AdminOrder[];
  ordersAvailable: boolean;
}) {
  const [period, setPeriod] = useState<DashboardPeriod>(30);
  const orderValue = (value: number) => (ordersAvailable ? value : '—');
  const summary: BusinessDashboardSummary = useMemo(
    () => summarizeBusinessDashboard(orders, products),
    [orders, products],
  );
  const analytics = useMemo(() => {
    const now = new Date();
    // La analítica opera sobre el conjunto administrativo ya cargado por
    // /api/orders (máximo 200 registros). Más adelante puede reemplazarse
    // por agregación server-side si el volumen lo requiere.
    return {
      series: buildDailySalesSeries(orders, period, now),
      sales: summarizePeriodSales(orders, period, now),
      topProducts: summarizeTopProducts(orders, period, now),
    };
  }, [orders, period]);

  return (
    <>
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="Indicadores principales">
        <KpiCard
          label="Ventas del mes"
          value={ordersAvailable ? formatCurrency(summary.monthlyPaidSales) : '—'}
          icon={CircleDollarSign}
          tone="success"
        />
        <KpiCard label="Pedidos cobrados" value={orderValue(summary.monthlyPaidOrders)} icon={ReceiptText} />
        <KpiCard
          label="Ticket promedio"
          value={ordersAvailable ? formatCurrency(summary.averageTicket) : '—'}
          icon={ClipboardCheck}
        />
        <KpiCard
          label="Requieren atención"
          value={orderValue(summary.ordersNeedingAttention)}
          icon={TriangleAlert}
          tone={ordersAvailable && summary.ordersNeedingAttention > 0 ? 'attention' : 'neutral'}
        />
      </section>

      {ordersAvailable ? (
        <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(280px,1fr)]">
          <SalesTrendChart
            series={analytics.series}
            summary={analytics.sales}
            period={period}
            onPeriodChange={setPeriod}
          />
          <TopProductsCard products={analytics.topProducts} period={period} />
        </div>
      ) : (
        <section className="rounded-[1.75rem] border border-slate-200 bg-stone-50 p-5 sm:p-6">
          <h3 className="text-lg font-semibold text-slate-950">Analítica de ventas</h3>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            La evolución de ventas y los productos más vendidos no están disponibles en este momento.
          </p>
        </section>
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.35fr)_minmax(280px,0.65fr)]">
        <section className="rounded-[1.75rem] border border-slate-200 bg-stone-50 p-5 sm:p-6">
          <div className="flex items-center gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-white text-slate-700 ring-1 ring-slate-200">
              <ShoppingBag aria-hidden="true" size={18} />
            </span>
            <h3 className="text-lg font-semibold text-slate-950">Estado de pedidos</h3>
          </div>
          {ordersAvailable ? (
            <dl className="mt-5 grid gap-x-8 gap-y-4 sm:grid-cols-2">
              <StatusRow label="Confirmados" value={summary.orderStatus.confirmed} dotClassName="bg-emerald-500" />
              <StatusRow label="Esperando pago" value={summary.orderStatus.waitingForPayment} dotClassName="bg-amber-400" />
              <StatusRow label="Requieren revisión" value={summary.orderStatus.requiringReview} dotClassName="bg-red-500" />
              <StatusRow label="Finalizados sin venta" value={summary.orderStatus.finalizedWithoutSale} dotClassName="bg-slate-400" />
            </dl>
          ) : (
            <p className="mt-5 text-sm leading-6 text-slate-600">Los pedidos no están disponibles en este momento.</p>
          )}
        </section>

        <section className="rounded-[1.75rem] border border-slate-200 bg-white p-5 sm:p-6">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 className="text-lg font-semibold text-slate-950">Catálogo</h3>
              <p className="mt-1 text-xs text-slate-500">Stock bajo ({LOW_STOCK_THRESHOLD} o menos)</p>
            </div>
            <Link to="/admin/productos" className="text-slate-500 transition hover:text-slate-950" aria-label="Ver catálogo">
              <ArrowRight aria-hidden="true" size={19} />
            </Link>
          </div>
          <dl className="mt-5 space-y-3">
            <CatalogRow label="Productos activos" value={summary.catalog.activeProducts} />
            <CatalogRow label="Productos ocultos" value={summary.catalog.hiddenProducts} />
            <CatalogRow label="Stock bajo" value={summary.catalog.lowStockProducts} />
          </dl>
          {summary.catalog.lowestStockProducts.length > 0 ? (
            <div className="mt-5 border-t border-slate-200 pt-4">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Menor disponibilidad</p>
              <ul className="mt-3 space-y-2">
                {summary.catalog.lowestStockProducts.map((product) => (
                  <li key={product.id} className="flex items-center justify-between gap-3 text-sm">
                    <span className="truncate text-slate-700">{product.name}</span>
                    <span className="shrink-0 font-semibold tabular-nums text-slate-950">{product.stockOnHand} u.</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </section>
      </div>

      {ordersAvailable ? (
        <section className="overflow-hidden rounded-[1.75rem] border border-slate-200 bg-stone-50">
          <div className="flex items-center justify-between gap-4 border-b border-slate-200 px-5 py-4 sm:px-6">
            <div>
              <h3 className="text-lg font-semibold text-slate-950">Pedidos recientes</h3>
              <p className="mt-1 text-xs text-slate-500">Los últimos movimientos de la tienda</p>
            </div>
            <Clock3 aria-hidden="true" className="text-slate-400" size={20} />
          </div>
          {summary.recentOrders.length === 0 ? (
            <p className="px-5 py-6 text-sm text-slate-600 sm:px-6">Todavía no hay pedidos.</p>
          ) : (
            <ul className="divide-y divide-slate-200">
              {summary.recentOrders.map((order) => (
                <RecentOrderRow key={order.id ?? orderReference(order)} order={order} />
              ))}
            </ul>
          )}
        </section>
      ) : null}
    </>
  );
}

function KpiCard({
  label,
  value,
  icon: Icon,
  tone = 'neutral',
}: {
  label: string;
  value: number | string;
  icon: LucideIcon;
  tone?: 'neutral' | 'success' | 'attention';
}) {
  const styles = {
    neutral: 'border-slate-200 bg-white text-slate-700',
    success: 'border-emerald-200 bg-emerald-50/50 text-emerald-700',
    attention: 'border-red-200 bg-red-50 text-red-700',
  }[tone];

  return (
    <article className={`min-h-36 rounded-[1.5rem] border p-5 ${styles}`}>
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-medium text-slate-600">{label}</p>
        <Icon aria-hidden="true" size={19} />
      </div>
      <p className="mt-6 text-3xl font-semibold tracking-tight text-slate-950 sm:text-[2rem]">{value}</p>
    </article>
  );
}

function StatusRow({ label, value, dotClassName }: { label: string; value: number; dotClassName: string }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-slate-200/80 pb-3">
      <dt className="flex items-center gap-2 text-sm text-slate-600">
        <span className={`h-2 w-2 rounded-full ${dotClassName}`} aria-hidden="true" />
        {label}
      </dt>
      <dd className="text-lg font-semibold tabular-nums text-slate-950">{value}</dd>
    </div>
  );
}

function CatalogRow({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center justify-between gap-4 text-sm">
      <dt className="text-slate-600">{label}</dt>
      <dd className="font-semibold tabular-nums text-slate-950">{value}</dd>
    </div>
  );
}

function RecentOrderRow({ order }: { order: AdminOrder }) {
  return (
    <li className="grid gap-2 px-5 py-4 text-sm sm:grid-cols-[0.75fr_1.35fr_0.9fr_1fr_1fr] sm:items-center sm:gap-4 sm:px-6">
      <span className="font-mono text-xs font-semibold text-slate-950">#{orderReference(order)}</span>
      <span className="truncate font-medium text-slate-800">{buyerLabel(order)}</span>
      <span className="font-semibold tabular-nums text-slate-950">{formatCurrency(orderAmount(order))}</span>
      <span className="w-fit rounded-full bg-white px-2.5 py-1 text-xs font-medium text-slate-600 ring-1 ring-slate-200">
        {orderLabel(order)}
      </span>
      <span className="text-xs text-slate-500 sm:text-right">{formatOrderDate(order.created_at)}</span>
    </li>
  );
}

function QuickLink({ to, label, icon: Icon }: { to: string; label: string; icon: LucideIcon }) {
  return (
    <Link
      to={to}
      className="inline-flex min-h-10 items-center gap-2 rounded-full border border-slate-300 bg-white px-3.5 py-2 text-sm font-semibold text-slate-700 transition hover:border-slate-900 hover:text-slate-950"
    >
      <Icon aria-hidden="true" size={16} />
      {label}
    </Link>
  );
}
