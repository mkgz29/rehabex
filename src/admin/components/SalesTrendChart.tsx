import { useId } from 'react';
import { TrendingUp } from 'lucide-react';

import { formatCurrency } from '../../lib/format';
import type { DailySalesPoint, DashboardPeriod, PeriodSalesSummary } from '../dashboardAnalytics';

const PERIODS: DashboardPeriod[] = [7, 30, 90];
const CHART_WIDTH = 720;
const CHART_HEIGHT = 220;
const PLOT_LEFT = 18;
const PLOT_RIGHT = 702;
const PLOT_TOP = 22;
const PLOT_BOTTOM = 178;

type ChartPoint = { x: number; y: number };

function compactCurrency(value: number) {
  const absoluteValue = Math.abs(value);
  const sign = value < 0 ? '-' : '';
  if (absoluteValue >= 1_000_000) {
    return `${sign}$${new Intl.NumberFormat('es-AR', { maximumFractionDigits: 1 }).format(absoluteValue / 1_000_000)}M`;
  }
  if (absoluteValue >= 1_000) {
    return `${sign}$${new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 }).format(absoluteValue / 1_000)}k`;
  }
  return `${sign}$${new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 }).format(absoluteValue)}`;
}

function shortDate(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  return match ? `${match[3]}/${match[2]}` : value;
}

function smoothPath(points: ChartPoint[]) {
  if (points.length === 0) return '';
  let path = `M ${points[0].x} ${points[0].y}`;
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const current = points[index];
    const middleX = (previous.x + current.x) / 2;
    path += ` C ${middleX} ${previous.y}, ${middleX} ${current.y}, ${current.x} ${current.y}`;
  }
  return path;
}

export function SalesTrendChart({
  series,
  summary,
  period,
  onPeriodChange,
}: {
  series: DailySalesPoint[];
  summary: PeriodSalesSummary;
  period: DashboardPeriod;
  onPeriodChange: (period: DashboardPeriod) => void;
}) {
  const chartId = useId().replace(/:/g, '');
  const titleId = `${chartId}-title`;
  const descriptionId = `${chartId}-description`;
  const finiteValues = series.map((point) => (Number.isFinite(point.revenue) ? point.revenue : 0));
  const minimum = Math.min(0, ...finiteValues);
  const maximum = Math.max(0, ...finiteValues);
  const range = maximum - minimum;
  const plotWidth = PLOT_RIGHT - PLOT_LEFT;
  const plotHeight = PLOT_BOTTOM - PLOT_TOP;
  const points = finiteValues.map((value, index) => ({
    x: series.length <= 1 ? PLOT_LEFT + plotWidth / 2 : PLOT_LEFT + (index / (series.length - 1)) * plotWidth,
    y: range === 0 ? PLOT_TOP + plotHeight / 2 : PLOT_TOP + ((maximum - value) / range) * plotHeight,
  }));
  const linePath = smoothPath(points);
  const zeroY = range === 0 ? PLOT_TOP + plotHeight / 2 : PLOT_TOP + (maximum / range) * plotHeight;
  const areaPath = points.length > 0
    ? `${linePath} L ${points[points.length - 1].x} ${zeroY} L ${points[0].x} ${zeroY} Z`
    : '';
  const hasRevenue = summary.revenue !== 0;
  const orderNoun = summary.orders === 1 ? 'pedido cobrado' : 'pedidos cobrados';
  const labelIndexes = series.length > 0
    ? [...new Set([0, Math.floor((series.length - 1) / 2), series.length - 1])]
    : [];

  return (
    <section className="min-w-0 rounded-[1.75rem] border border-slate-200 bg-stone-50 p-5 sm:p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-2 text-slate-950">
            <TrendingUp aria-hidden="true" size={19} />
            <h3 className="text-lg font-semibold">Evolución de ventas</h3>
          </div>
          <p className="mt-4 text-3xl font-semibold tracking-tight text-slate-950 sm:text-4xl">
            {formatCurrency(summary.revenue)}
          </p>
          <p className="mt-1 text-sm text-slate-600">{summary.orders} {orderNoun} · últimos {period} días</p>
        </div>

        <div className="inline-flex w-fit rounded-full border border-slate-200 bg-white p-1" aria-label="Período de ventas">
          {PERIODS.map((days) => (
            <button
              key={days}
              type="button"
              aria-pressed={period === days}
              onClick={() => onPeriodChange(days)}
              className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${
                period === days ? 'bg-slate-900 text-white' : 'text-slate-500 hover:text-slate-950'
              }`}
            >
              {days} días
            </button>
          ))}
        </div>
      </div>

      {hasRevenue && points.length > 0 ? (
        <div className="mt-7 min-w-0">
          <svg
            className="block h-auto w-full"
            viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
            role="img"
            aria-labelledby={`${titleId} ${descriptionId}`}
          >
            <title id={titleId}>{`Evolución diaria de ventas de los últimos ${period} días`}</title>
            <desc id={descriptionId}>
              Total {formatCurrency(summary.revenue)} en {summary.orders} {orderNoun}. La línea representa las ventas cobradas por día.
            </desc>
            <defs>
              <linearGradient id={`${chartId}-fill`} x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor="#10b981" stopOpacity="0.18" />
                <stop offset="100%" stopColor="#10b981" stopOpacity="0" />
              </linearGradient>
            </defs>
            <line x1={PLOT_LEFT} x2={PLOT_RIGHT} y1={PLOT_TOP} y2={PLOT_TOP} stroke="#e2e8f0" strokeDasharray="4 7" />
            <line x1={PLOT_LEFT} x2={PLOT_RIGHT} y1={zeroY} y2={zeroY} stroke="#cbd5e1" />
            <path d={areaPath} fill={`url(#${chartId}-fill)`} />
            <path d={linePath} fill="none" stroke="#047857" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
            <circle
              cx={points[points.length - 1].x}
              cy={points[points.length - 1].y}
              r="4.5"
              fill="#f8fafc"
              stroke="#047857"
              strokeWidth="3"
            />
            <text x={PLOT_LEFT} y={15} fill="#64748b" fontSize="12">{compactCurrency(maximum)}</text>
          </svg>
          <div className="flex justify-between gap-3 text-xs font-medium text-slate-500" aria-hidden="true">
            {labelIndexes.map((index) => <span key={series[index].date}>{shortDate(series[index].date)}</span>)}
          </div>
        </div>
      ) : (
        <div className="mt-7 flex min-h-52 items-center justify-center rounded-2xl border border-dashed border-slate-300 bg-white/70 px-6 text-center">
          <div>
            <p className="font-medium text-slate-800">Todavía no hay ventas cobradas en este período.</p>
            <p className="mt-1 text-sm text-slate-500">El gráfico aparecerá cuando se registre una venta.</p>
          </div>
        </div>
      )}
    </section>
  );
}
