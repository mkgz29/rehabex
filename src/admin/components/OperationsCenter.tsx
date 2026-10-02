import type { ReactNode } from 'react';
import { AlertTriangle, ArrowRight, CheckCircle2, ClipboardList, Warehouse, type LucideIcon } from 'lucide-react';
import { Link } from 'react-router-dom';

import type { DashboardOperations } from '../dashboardOperations';
import { AdminCard } from './AdminCard';

function StockList({ products }: { products: DashboardOperations['outOfStockProducts'] }) {
  return (
    <ul className="mt-2 space-y-1.5">
      {products.slice(0, 5).map((product) => (
        <li key={product.id} className="flex min-w-0 items-center justify-between gap-3 text-xs">
          <span className="truncate text-slate-600">{product.name}</span>
          <span className="shrink-0 font-semibold tabular-nums text-slate-800">{product.stockOnHand} u.</span>
        </li>
      ))}
    </ul>
  );
}

function ActionRow({
  value,
  label,
  icon: Icon,
  tone = 'neutral',
  children,
  countLabel,
}: {
  value: number;
  label: string;
  icon: LucideIcon;
  tone?: 'neutral' | 'warning' | 'danger';
  children?: ReactNode;
  countLabel?: string;
}) {
  const toneStyles = {
    neutral: 'bg-stone-100 text-slate-700',
    warning: 'bg-amber-50 text-amber-800',
    danger: 'bg-red-50 text-red-800',
  }[tone];

  return (
    <li className="grid min-w-0 grid-cols-[2.5rem_minmax(0,1fr)] gap-3 border-t border-slate-100 px-5 py-4 sm:px-6">
      <span className={`flex h-10 w-10 items-center justify-center rounded-xl ${toneStyles}`} aria-hidden="true">
        <Icon size={18} />
      </span>
      <div className="min-w-0">
        <div className="flex items-baseline justify-between gap-4">
          <p className="text-sm font-medium text-slate-800">{label}</p>
          <p
            className={`shrink-0 text-lg font-semibold tabular-nums ${tone === 'danger' ? 'text-red-800' : tone === 'warning' ? 'text-amber-800' : 'text-slate-950'}`}
            aria-label={countLabel}
          >
            {value}
          </p>
        </div>
        {children}
      </div>
    </li>
  );
}

function OperationsActions({ attentionCount, stockAlerts }: { attentionCount: number; stockAlerts: number }) {
  return (
    <div className="flex flex-wrap gap-2">
      <Link
        to="/admin/pedidos"
        className={`inline-flex min-h-10 items-center gap-2 rounded-xl px-3.5 py-2 text-xs font-semibold transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900 ${
          attentionCount > 0
            ? 'bg-red-700 text-white hover:bg-red-800'
            : 'border border-slate-300 bg-white text-slate-700 hover:border-slate-900'
        }`}
      >
        {attentionCount > 0 ? 'Revisar pedidos' : 'Ver pedidos'}
        <ArrowRight aria-hidden="true" size={14} />
      </Link>
      <Link
        to="/admin/productos"
        className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 transition hover:border-slate-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900"
      >
        {stockAlerts > 0 ? 'Revisar stock' : 'Ver productos'}
        <ArrowRight aria-hidden="true" size={14} />
      </Link>
    </div>
  );
}

export function OperationsCenter({
  operations,
  ordersAvailable,
}: {
  operations: DashboardOperations;
  ordersAvailable: boolean;
}) {
  const activeOrderWork = operations.ordersToPrepare.length
    + operations.ordersPreparing.length
    + operations.ordersReadyForPickup.length
    + operations.ordersShipped.length;
  const stockAlerts = operations.outOfStockProducts.length + operations.criticalStockProducts.length;
  const attentionCount = operations.ordersNeedingAttention.length;
  const hasDanger = attentionCount > 0 || operations.outOfStockProducts.length > 0;
  const hasWarning = operations.criticalStockProducts.length > 0;
  const hasIssues = hasDanger || hasWarning;
  const allClear = ordersAvailable && activeOrderWork === 0 && stockAlerts === 0 && attentionCount === 0;

  if (allClear) {
    return (
      <AdminCard as="section" padding="none" className="px-5 py-5 sm:px-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-emerald-700">
              <CheckCircle2 aria-hidden="true" size={19} />
            </span>
            <div>
              <h3 className="text-base font-semibold text-slate-950">Operación</h3>
              <p className="mt-0.5 text-sm text-slate-600">Todo al día por ahora.</p>
            </div>
          </div>
          <OperationsActions attentionCount={attentionCount} stockAlerts={stockAlerts} />
        </div>
      </AdminCard>
    );
  }

  return (
    <AdminCard as="section" padding="none" className="overflow-hidden">
      <div className="flex flex-col gap-4 px-5 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <div className="flex items-start gap-3">
          <span className={`mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${
            hasDanger ? 'bg-red-50 text-red-800' : hasWarning ? 'bg-amber-50 text-amber-800' : 'bg-stone-100 text-slate-700'
          }`}>
            {hasIssues ? <AlertTriangle aria-hidden="true" size={19} /> : <ClipboardList aria-hidden="true" size={19} />}
          </span>
          <div>
            <h3 className="text-lg font-semibold text-slate-950">Acciones operativas</h3>
            <p className="mt-1 text-sm text-slate-600">Tareas pendientes y alertas que conviene resolver.</p>
          </div>
        </div>
        <OperationsActions attentionCount={attentionCount} stockAlerts={stockAlerts} />
      </div>

      <ul className="grid min-w-0 md:grid-cols-2">
        {!ordersAvailable ? (
          <li className="border-t border-slate-100 px-5 py-4 text-sm leading-6 text-slate-600 sm:px-6 md:col-span-2">
            Los pedidos no están disponibles en este momento; las alertas de inventario siguen actualizadas.
          </li>
        ) : null}
        {ordersAvailable && attentionCount > 0 ? (
          <ActionRow
            value={attentionCount}
            label={attentionCount === 1 ? 'Pedido que requiere revisión' : 'Pedidos que requieren revisión'}
            icon={AlertTriangle}
            tone="danger"
          />
        ) : null}
        {operations.outOfStockProducts.length > 0 ? (
          <ActionRow
            value={operations.outOfStockProducts.length}
            label="Productos sin stock"
            icon={Warehouse}
            tone="danger"
            countLabel={operations.outOfStockProducts.length === 1 ? '1 producto sin stock' : `${operations.outOfStockProducts.length} productos sin stock`}
          >
            <StockList products={operations.outOfStockProducts} />
          </ActionRow>
        ) : null}
        {ordersAvailable && operations.ordersToPrepare.length > 0 ? (
          <ActionRow value={operations.ordersToPrepare.length} label="Pedidos por preparar" icon={ClipboardList} />
        ) : null}
        {operations.criticalStockProducts.length > 0 ? (
          <ActionRow
            value={operations.criticalStockProducts.length}
            label="Productos con stock crítico"
            icon={Warehouse}
            tone="warning"
          >
            <StockList products={operations.criticalStockProducts} />
          </ActionRow>
        ) : null}
        {ordersAvailable && operations.ordersPreparing.length > 0 ? (
          <ActionRow value={operations.ordersPreparing.length} label="Pedidos en preparación" icon={ClipboardList} />
        ) : null}
        {ordersAvailable && operations.ordersReadyForPickup.length > 0 ? (
          <ActionRow value={operations.ordersReadyForPickup.length} label="Listos para retiro" icon={ClipboardList} />
        ) : null}
        {ordersAvailable && operations.ordersShipped.length > 0 ? (
          <ActionRow value={operations.ordersShipped.length} label="Pedidos enviados" icon={ClipboardList} />
        ) : null}
      </ul>
    </AdminCard>
  );
}
