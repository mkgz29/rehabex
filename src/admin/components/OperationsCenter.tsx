import { AlertTriangle, ArrowRight, CheckCircle2, ClipboardList, PackageSearch, Warehouse } from 'lucide-react';
import { Link } from 'react-router-dom';

import type { DashboardOperations } from '../dashboardOperations';

function CountLine({ value, label }: { value: number; label: string }) {
  return (
    <li className="flex items-center justify-between gap-4 text-sm">
      <span className="text-slate-600">{label}</span>
      <span className="text-lg font-semibold tabular-nums text-slate-950">{value}</span>
    </li>
  );
}

function StockList({ products }: { products: DashboardOperations['outOfStockProducts'] }) {
  return (
    <ul className="space-y-2">
      {products.slice(0, 5).map((product) => (
        <li key={product.id} className="flex min-w-0 items-center justify-between gap-3 text-sm">
          <span className="truncate text-slate-700">{product.name}</span>
          <span className="shrink-0 font-semibold tabular-nums text-slate-950">{product.stockOnHand} u.</span>
        </li>
      ))}
    </ul>
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
  const hasUrgentIssues = attentionCount > 0 || stockAlerts > 0;
  const allClear = ordersAvailable && activeOrderWork === 0 && stockAlerts === 0 && attentionCount === 0;
  const panelStyle = attentionCount > 0
    ? 'border-red-200 bg-red-50/30'
    : stockAlerts > 0
      ? 'border-amber-200 bg-amber-50/30'
      : 'border-slate-200 bg-white';
  const iconStyle = attentionCount > 0
    ? 'bg-red-100 text-red-800'
    : stockAlerts > 0
      ? 'bg-amber-100 text-amber-800'
      : 'bg-stone-100 text-slate-700';

  return (
    <section className={`overflow-hidden rounded-[1.75rem] border ${panelStyle}`}>
      <div className="flex flex-col gap-3 border-b border-slate-200/80 px-5 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <div className="flex items-start gap-3">
          <span className={`mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${iconStyle}`}>
            {hasUrgentIssues ? <AlertTriangle aria-hidden="true" size={19} /> : <ClipboardList aria-hidden="true" size={19} />}
          </span>
          <div>
            <h3 className="text-lg font-semibold text-slate-950">{hasUrgentIssues ? 'Requiere tu atención' : 'Operación'}</h3>
            <p className="mt-1 text-sm text-slate-600">Prioridades actuales de pedidos e inventario.</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            to="/admin/pedidos"
            className={`inline-flex min-h-9 items-center gap-2 rounded-full px-3.5 py-2 text-xs font-semibold transition ${
              attentionCount > 0 ? 'bg-red-700 text-white hover:bg-red-800' : 'border border-slate-300 bg-white text-slate-700 hover:border-slate-900'
            }`}
          >
            {attentionCount > 0 ? 'Revisar pedidos' : 'Ver pedidos'}
            <ArrowRight aria-hidden="true" size={14} />
          </Link>
          <Link
            to="/admin/productos"
            className="inline-flex min-h-9 items-center gap-2 rounded-full border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 transition hover:border-slate-900"
          >
            Ver productos
            <ArrowRight aria-hidden="true" size={14} />
          </Link>
        </div>
      </div>

      {allClear ? (
        <div className="flex items-center gap-3 px-5 py-6 sm:px-6">
          <CheckCircle2 aria-hidden="true" className="shrink-0 text-slate-500" size={21} />
          <div>
            <p className="font-medium text-slate-900">Todo al día por ahora.</p>
            <p className="mt-1 text-sm text-slate-500">No hay tareas operativas ni alertas de stock.</p>
          </div>
        </div>
      ) : (
        <div className="grid min-w-0 divide-y divide-slate-200/80 md:grid-cols-3 md:divide-x md:divide-y-0">
          <div className="min-w-0 p-5 sm:p-6">
            <div className="flex items-center gap-2">
              <PackageSearch aria-hidden="true" className="text-slate-500" size={18} />
              <h4 className="text-sm font-semibold text-slate-950">Pedidos</h4>
            </div>
            {!ordersAvailable ? (
              <p className="mt-4 text-sm leading-6 text-slate-500">Los pedidos no están disponibles en este momento.</p>
            ) : activeOrderWork === 0 ? (
              <p className="mt-4 text-sm leading-6 text-slate-500">Sin tareas de pedidos pendientes.</p>
            ) : (
              <ul className="mt-4 space-y-3">
                {operations.ordersToPrepare.length > 0 ? <CountLine value={operations.ordersToPrepare.length} label="Por preparar" /> : null}
                {operations.ordersPreparing.length > 0 ? <CountLine value={operations.ordersPreparing.length} label="En preparación" /> : null}
                {operations.ordersReadyForPickup.length > 0 ? <CountLine value={operations.ordersReadyForPickup.length} label="Listos para retiro" /> : null}
                {operations.ordersShipped.length > 0 ? <CountLine value={operations.ordersShipped.length} label="Enviados" /> : null}
              </ul>
            )}
          </div>

          <div className="min-w-0 p-5 sm:p-6">
            <div className="flex items-center gap-2">
              <Warehouse aria-hidden="true" className="text-slate-500" size={18} />
              <h4 className="text-sm font-semibold text-slate-950">Inventario</h4>
            </div>
            {stockAlerts === 0 ? (
              <p className="mt-4 text-sm leading-6 text-slate-500">Sin alertas de stock crítico.</p>
            ) : (
              <div className="mt-4 space-y-4">
                {operations.outOfStockProducts.length > 0 ? (
                  <div>
                    <p className="mb-2 text-xs font-semibold uppercase tracking-[0.12em] text-red-700">
                      Sin stock · {operations.outOfStockProducts.length}
                    </p>
                    <StockList products={operations.outOfStockProducts} />
                  </div>
                ) : null}
                {operations.criticalStockProducts.length > 0 ? (
                  <div>
                    <p className="mb-2 text-xs font-semibold uppercase tracking-[0.12em] text-amber-700">
                      Stock crítico · {operations.criticalStockProducts.length}
                    </p>
                    <StockList products={operations.criticalStockProducts} />
                  </div>
                ) : null}
              </div>
            )}
          </div>

          <div className="min-w-0 p-5 sm:p-6">
            <div className="flex items-center gap-2">
              <AlertTriangle aria-hidden="true" className={attentionCount > 0 ? 'text-red-700' : 'text-slate-500'} size={18} />
              <h4 className="text-sm font-semibold text-slate-950">Atención</h4>
            </div>
            {!ordersAvailable ? (
              <p className="mt-4 text-sm leading-6 text-slate-500">No se pudo verificar el estado de los pedidos.</p>
            ) : attentionCount > 0 ? (
              <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3">
                <p className="text-2xl font-semibold tabular-nums text-red-900">{attentionCount}</p>
                <p className="mt-1 text-sm text-red-800">
                  {attentionCount === 1 ? 'pedido requiere revisión' : 'pedidos requieren revisión'}
                </p>
              </div>
            ) : (
              <div className="mt-4 flex items-center gap-2 text-sm text-slate-500">
                <CheckCircle2 aria-hidden="true" size={17} />
                <span>Sin pedidos para revisar.</span>
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
