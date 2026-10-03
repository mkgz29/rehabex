import { useEffect, useMemo, useState, type ReactNode } from 'react';
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
import { AdminCard } from '../components/AdminCard';
import { AdminNotice } from '../components/AdminNotice';
import { AdminPageHeader } from '../components/AdminPageHeader';
import { AdminSectionHeading } from '../components/AdminSectionHeading';
import { MetricDelta } from '../components/MetricDelta';
import { OperationsCenter } from '../components/OperationsCenter';
import { SalesTrendChart } from '../components/SalesTrendChart';
import { TopProductsCard } from '../components/TopProductsCard';
import {
  buildDailySalesSeries,
  comparePeriodSales,
  summarizeTopProducts,
  type DashboardPeriod,
} from '../dashboardAnalytics';
import { summarizeDashboardOperations } from '../dashboardOperations';
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
    <div className="space-y-7">
      <AdminPageHeader
        title="Resumen"
        description="Estado general de tu tienda."
        actions={
          <nav className="flex flex-wrap gap-2" aria-label="Acciones rápidas">
            <QuickLink to="/admin/productos" label="Agregar producto" icon={PackagePlus} primary />
            <QuickLink to="/admin/pedidos" label="Ver pedidos" icon={ShoppingBag} />
            <QuickLink to="/admin/pagina" label="Editar página" icon={PencilLine} />
          </nav>
        }
      />

      {state.status === 'loading' ? (
        <AdminCard tone="muted" aria-busy="true" className="text-sm text-slate-600">
          Cargando resumen…
        </AdminCard>
      ) : null}

      {state.status === 'error' ? <AdminNotice>{state.message}</AdminNotice> : null}

      {state.status === 'ready' ? (
        <DashboardContent products={state.products} orders={state.orders} ordersAvailable={state.ordersAvailable} />
      ) : null}
    </div>
  );
}

export function DashboardContent({
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
    // La analítica y sus comparaciones operan sobre el conjunto ya cargado por
    // /api/orders (máximo 200 registros). Más adelante puede reemplazarse
    // por agregación server-side si el volumen lo requiere.
    const comparison = comparePeriodSales(orders, period, now);
    return {
      series: buildDailySalesSeries(orders, period, now),
      sales: { revenue: comparison.currentRevenue, orders: comparison.currentOrders },
      comparison,
      topProducts: summarizeTopProducts(orders, period, now),
    };
  }, [orders, period]);
  const operations = useMemo(
    () => summarizeDashboardOperations(orders, products),
    [orders, products],
  );

  return (
    <div className="space-y-8 lg:space-y-10">
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="Indicadores principales">
        <KpiCard
          label="Ventas del mes"
          value={ordersAvailable ? formatCurrency(summary.monthlyPaidSales) : '—'}
          icon={CircleDollarSign}
          tone="success"
          delta={ordersAvailable ? (
            <MetricDelta
              comparison={summary.monthlyComparison.sales}
              comparisonLabel="mes anterior"
              newLabel="Nuevas ventas este mes"
              flatLabel="Igual que el mes anterior"
            />
          ) : null}
        />
        <KpiCard
          label="Pedidos cobrados"
          value={orderValue(summary.monthlyPaidOrders)}
          icon={ReceiptText}
          delta={ordersAvailable ? (
            <MetricDelta
              comparison={summary.monthlyComparison.orders}
              comparisonLabel="mes anterior"
              newLabel="Nuevos pedidos este mes"
              flatLabel="Igual que el mes anterior"
            />
          ) : null}
        />
        <KpiCard
          label="Ticket promedio"
          value={ordersAvailable ? formatCurrency(summary.averageTicket) : '—'}
          icon={ClipboardCheck}
          delta={ordersAvailable ? (
            <MetricDelta
              comparison={summary.monthlyComparison.averageTicket}
              comparisonLabel="mes anterior"
              newLabel="Sin comparación anterior"
              flatLabel="Igual que el mes anterior"
            />
          ) : null}
        />
        <KpiCard
          label="Requieren atención"
          value={orderValue(summary.ordersNeedingAttention)}
          icon={TriangleAlert}
          tone={ordersAvailable && summary.ordersNeedingAttention > 0 ? 'attention' : 'neutral'}
        />
      </section>

      {ordersAvailable ? (
        <section
          className="grid min-w-0 items-stretch gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(280px,1fr)]"
          aria-label="Analítica de ventas"
        >
          <SalesTrendChart
            series={analytics.series}
            summary={analytics.sales}
            comparison={analytics.comparison.revenueComparison}
            period={period}
            onPeriodChange={setPeriod}
          />
          <TopProductsCard products={analytics.topProducts} period={period} />
        </section>
      ) : (
        <AdminCard tone="muted">
          <AdminSectionHeading
            as="h3"
            title="Analítica de ventas"
            description="La evolución de ventas y los productos más vendidos no están disponibles en este momento."
          />
        </AdminCard>
      )}

      <OperationsCenter operations={operations} ordersAvailable={ordersAvailable} />

      <div className="space-y-4">
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1.35fr)_minmax(280px,0.65fr)]">
          <AdminCard>
            <div className="flex items-center gap-3">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-stone-100 text-slate-700">
                <ShoppingBag aria-hidden="true" size={18} />
              </span>
              <h3 className="text-base font-semibold text-slate-900">Estado de pedidos</h3>
            </div>
            {ordersAvailable ? (
              <dl className="mt-4 grid gap-x-8 sm:grid-cols-2">
                <StatusRow label="Confirmados" value={summary.orderStatus.confirmed} dotClassName="bg-emerald-500" />
                <StatusRow label="Esperando pago" value={summary.orderStatus.waitingForPayment} dotClassName="bg-amber-400" />
                <StatusRow label="Requieren revisión" value={summary.orderStatus.requiringReview} dotClassName="bg-red-500" />
                <StatusRow label="Finalizados sin venta" value={summary.orderStatus.finalizedWithoutSale} dotClassName="bg-slate-400" />
              </dl>
            ) : (
              <p className="mt-4 text-sm leading-6 text-slate-600">Los pedidos no están disponibles en este momento.</p>
            )}
          </AdminCard>

          <AdminCard>
            <div className="flex items-center justify-between gap-3">
              <div>
                <h3 className="text-base font-semibold text-slate-900">Catálogo</h3>
                <p className="mt-1 text-xs text-slate-500">Salud general del inventario</p>
              </div>
              <Link
                to="/admin/productos"
                className="rounded-lg p-2 text-slate-500 transition hover:bg-stone-100 hover:text-slate-950 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900"
                aria-label="Ver catálogo"
              >
                <ArrowRight aria-hidden="true" size={19} />
              </Link>
            </div>
            <dl className="mt-4 divide-y divide-slate-100 border-t border-slate-100">
              <CatalogRow label="Productos activos" value={summary.catalog.activeProducts} />
              <CatalogRow label="Productos ocultos" value={summary.catalog.hiddenProducts} />
              <CatalogRow label={`Stock bajo (${LOW_STOCK_THRESHOLD} o menos)`} value={summary.catalog.lowStockProducts} />
            </dl>
          </AdminCard>
        </div>

        {ordersAvailable ? (
          <AdminCard padding="none" className="overflow-hidden">
            <div className="flex items-center justify-between gap-4 border-b border-slate-200 px-5 py-4 sm:px-6">
            <div>
              <h3 className="text-base font-semibold text-slate-900">Pedidos recientes</h3>
              <p className="mt-1 text-xs text-slate-500">Los últimos movimientos de la tienda</p>
            </div>
            <Clock3 aria-hidden="true" className="text-slate-400" size={20} />
            </div>
            {summary.recentOrders.length === 0 ? (
              <p className="bg-stone-50/60 px-5 py-6 text-sm text-slate-600 sm:px-6">Todavía no hay pedidos.</p>
            ) : (
              <>
                <div className="hidden grid-cols-[0.75fr_1.35fr_0.9fr_1fr_1fr] gap-4 border-b border-slate-100 bg-stone-50/60 px-6 py-2.5 text-xs font-medium text-slate-500 sm:grid">
                  <span>Pedido</span>
                  <span>Comprador</span>
                  <span>Total</span>
                  <span>Estado</span>
                  <span className="text-right">Fecha</span>
                </div>
                <ul className="divide-y divide-slate-100">
                  {summary.recentOrders.map((order) => (
                    <RecentOrderRow key={order.id ?? orderReference(order)} order={order} />
                  ))}
                </ul>
              </>
            )}
          </AdminCard>
        ) : null}
      </div>
    </div>
  );
}

function KpiCard({
  label,
  value,
  icon: Icon,
  tone = 'neutral',
  delta,
}: {
  label: string;
  value: number | string;
  icon: LucideIcon;
  tone?: 'neutral' | 'success' | 'attention';
  delta?: ReactNode;
}) {
  const styles = {
    neutral: 'border-slate-200 text-slate-500',
    success: 'border-slate-200 text-emerald-700',
    attention: 'border-red-300 text-red-700',
  }[tone];

  return (
    <article className={`flex min-h-36 flex-col rounded-2xl border bg-white p-5 ${styles}`}>
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-medium text-slate-600">{label}</p>
        <Icon aria-hidden="true" size={19} />
      </div>
      <p className="mt-auto pt-5 text-3xl font-semibold tracking-tight text-slate-950 sm:text-[2rem]">{value}</p>
      <div className="mt-2 min-h-5">{delta}</div>
    </article>
  );
}

function StatusRow({ label, value, dotClassName }: { label: string; value: number; dotClassName: string }) {
  return (
    <div className="flex items-center justify-between gap-4 border-t border-slate-100 py-3">
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
    <div className="flex items-center justify-between gap-4 py-3 text-sm">
      <dt className="text-slate-600">{label}</dt>
      <dd className="font-semibold tabular-nums text-slate-950">{value}</dd>
    </div>
  );
}

function RecentOrderRow({ order }: { order: AdminOrder }) {
  return (
    <li className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-2 px-5 py-4 text-sm sm:grid-cols-[0.75fr_1.35fr_0.9fr_1fr_1fr] sm:items-center sm:gap-4 sm:px-6">
      <span className="min-w-0 truncate text-xs font-semibold text-slate-950">#{orderReference(order)}</span>
      <span className="col-start-1 row-start-2 min-w-0 truncate font-medium text-slate-800 sm:col-start-2 sm:row-start-1">{buyerLabel(order)}</span>
      <span className="col-start-1 row-start-3 font-semibold tabular-nums text-slate-950 sm:col-start-3 sm:row-start-1">{formatCurrency(orderAmount(order))}</span>
      <span className="col-start-2 row-start-1 max-w-full truncate rounded-full bg-stone-100 px-2.5 py-1 text-xs font-medium text-slate-600 sm:col-start-4">
        {orderLabel(order)}
      </span>
      <span className="col-start-2 row-start-3 whitespace-nowrap text-right text-xs text-slate-500 sm:col-start-5 sm:row-start-1">{formatOrderDate(order.created_at)}</span>
    </li>
  );
}

function QuickLink({
  to,
  label,
  icon: Icon,
  primary = false,
}: {
  to: string;
  label: string;
  icon: LucideIcon;
  primary?: boolean;
}) {
  return (
    <Link
      to={to}
      className={`inline-flex min-h-10 items-center gap-2 rounded-xl border px-3.5 py-2 text-sm font-semibold transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900 ${
        primary
          ? 'border-slate-950 bg-slate-950 text-white hover:bg-slate-800'
          : 'border-slate-300 bg-white text-slate-700 hover:border-slate-900 hover:text-slate-950'
      }`}
    >
      <Icon aria-hidden="true" size={16} />
      {label}
    </Link>
  );
}
