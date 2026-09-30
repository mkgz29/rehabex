import { ArrowDownRight, ArrowUpRight, Minus, Sparkles } from 'lucide-react';

import type { MetricComparison } from '../salesMetrics';

function percentageLabel(value: number | null) {
  if (value === null || !Number.isFinite(value)) return null;
  return `${new Intl.NumberFormat('es-AR', { maximumFractionDigits: 1 }).format(Math.abs(value))}%`;
}

export function MetricDelta({
  comparison,
  comparisonLabel,
  newLabel,
  flatLabel,
}: {
  comparison: MetricComparison;
  comparisonLabel: string;
  newLabel: string;
  flatLabel: string;
}) {
  if (comparison.direction === 'new') {
    return (
      <p className="flex min-w-0 items-start gap-1.5 text-xs font-medium leading-5 text-emerald-700">
        <Sparkles aria-hidden="true" className="mt-0.5 shrink-0" size={14} />
        <span>{newLabel}</span>
      </p>
    );
  }

  if (comparison.direction === 'flat') {
    return (
      <p className="flex min-w-0 items-start gap-1.5 text-xs font-medium leading-5 text-slate-500">
        <Minus aria-hidden="true" className="mt-0.5 shrink-0" size={14} />
        <span>{flatLabel}</span>
      </p>
    );
  }

  const percentage = percentageLabel(comparison.percentage);
  const isUp = comparison.direction === 'up';
  const Icon = isUp ? ArrowUpRight : ArrowDownRight;

  return (
    <p className={`flex min-w-0 items-start gap-1.5 text-xs font-medium leading-5 ${isUp ? 'text-emerald-700' : 'text-amber-700'}`}>
      <Icon aria-hidden="true" className="mt-0.5 shrink-0" size={14} />
      <span>{percentage ? `${percentage} vs ${comparisonLabel}` : `Cambio vs ${comparisonLabel}`}</span>
    </p>
  );
}
