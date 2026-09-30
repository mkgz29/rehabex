import { Trophy } from 'lucide-react';

import { formatCurrency } from '../../lib/format';
import type { DashboardPeriod, ProductSalesSummary } from '../dashboardAnalytics';

export function TopProductsCard({ products, period }: { products: ProductSalesSummary[]; period: DashboardPeriod }) {
  const maximumQuantity = Math.max(0, ...products.map((product) => product.quantity));

  return (
    <section className="min-w-0 rounded-2xl border border-slate-200 bg-white p-5 sm:p-6">
      <div className="flex items-center gap-2 text-slate-950">
        <Trophy aria-hidden="true" className="text-slate-500" size={18} />
        <h3 className="text-lg font-semibold">Productos más vendidos</h3>
      </div>
      <p className="mt-1 text-xs text-slate-500">Últimos {period} días</p>

      {products.length === 0 ? (
        <div className="mt-6 flex min-h-52 items-center justify-center rounded-xl border border-dashed border-slate-300 bg-stone-50/70 px-5 text-center">
          <p className="max-w-xs text-sm leading-6 text-slate-600">Todavía no hay ventas de productos en este período.</p>
        </div>
      ) : (
        <ol className="mt-4 divide-y divide-slate-100 border-t border-slate-100">
          {products.map((product, index) => {
            const barWidth = maximumQuantity > 0 ? (product.quantity / maximumQuantity) * 100 : 0;
            return (
              <li key={product.name} className="py-3.5">
                <div className="grid grid-cols-[1.5rem_minmax(0,1fr)_auto] items-start gap-2.5">
                  <span className="pt-0.5 text-xs font-semibold tabular-nums text-slate-400" aria-label={`Posición ${index + 1}`}>
                    {index + 1}
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-slate-800" title={product.name}>{product.name}</p>
                  </div>
                  <div className="text-right">
                    <p className="whitespace-nowrap text-sm font-semibold tabular-nums text-slate-950">{product.quantity} u.</p>
                    <p className="mt-0.5 whitespace-nowrap text-xs tabular-nums text-slate-500">{formatCurrency(product.revenue)}</p>
                  </div>
                </div>
                <div className="ml-8 mt-2 h-1 overflow-hidden rounded-full bg-slate-100" aria-hidden="true">
                  <div className="h-full rounded-full bg-emerald-700/50" style={{ width: `${barWidth}%` }} />
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
