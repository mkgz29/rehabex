import { PackageSearch } from 'lucide-react';

import { formatOrderDate } from '../orderPresentation';
import { SUPPORT_STATUS_FILTERS, SUPPORT_STATUS_LABELS, SUPPORT_STATUS_TONE, supportRequestPreview, type SupportStatusFilter } from '../support/supportPresentation';
import type { SupportRequest } from '../../services/adminApi';
import { AdminCard } from './AdminCard';
import { AdminEmptyState } from './AdminEmptyState';
import { AdminSecondaryButton } from './AdminButton';
import { StatusBadge } from './StatusBadge';

type SupportRequestListProps = {
  items: SupportRequest[] | null;
  error: string | null;
  onRetry: () => void;
  filter: SupportStatusFilter;
  onFilterChange: (filter: SupportStatusFilter) => void;
  selectedId: string | null;
  onSelect: (id: string) => void;
};

export function SupportRequestList({ items, error, onRetry, filter, onFilterChange, selectedId, onSelect }: SupportRequestListProps) {
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2" role="tablist" aria-label="Filtrar por estado">
        {SUPPORT_STATUS_FILTERS.map((option) => (
          <button
            key={option.value}
            type="button"
            role="tab"
            aria-selected={filter === option.value}
            onClick={() => onFilterChange(option.value)}
            className={`min-h-9 rounded-full border px-3.5 py-1.5 text-xs font-semibold transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900 ${
              filter === option.value ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-300 bg-white text-slate-700 hover:border-slate-900'
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>

      {error ? (
        <div role="alert" className="flex flex-col items-center gap-3 rounded-2xl border border-red-200 bg-red-50 p-6 text-center">
          <p className="text-sm text-red-700">{error}</p>
          <AdminSecondaryButton onClick={onRetry}>Reintentar</AdminSecondaryButton>
        </div>
      ) : items === null ? (
        <AdminCard tone="muted" aria-busy="true" className="text-sm text-slate-600">
          Cargando consultas…
        </AdminCard>
      ) : items.length === 0 ? (
        <AdminEmptyState
          icon={PackageSearch}
          title="No hay consultas para este filtro."
          description="Las consultas que registres van a aparecer acá."
        />
      ) : (
        <AdminCard padding="none" className="overflow-hidden">
          <ul className="divide-y divide-slate-100">
            {items.map((item) => {
              const isSelected = item.id === selectedId;
              return (
                <li key={item.id}>
                  <button
                    type="button"
                    onClick={() => onSelect(item.id)}
                    aria-current={isSelected ? 'true' : undefined}
                    className={`block w-full px-4 py-3.5 text-left transition focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-slate-900 ${
                      isSelected ? 'bg-accent-soft' : 'hover:bg-stone-50'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-slate-900">{item.customerName}</p>
                        <p className="truncate text-xs font-medium text-slate-600">{item.subject || 'Sin asunto'}</p>
                      </div>
                      <StatusBadge size="sm" tone={SUPPORT_STATUS_TONE[item.status]} label={SUPPORT_STATUS_LABELS[item.status]} />
                    </div>
                    <p className="mt-1.5 line-clamp-1 text-xs leading-5 text-slate-500">{supportRequestPreview(item.message)}</p>
                    <div className="mt-1.5 flex items-center gap-3 text-[11px] text-slate-400">
                      <span>{formatOrderDate(item.createdAt)}</span>
                      {item.orderId ? <span className="font-medium text-slate-500">Pedido vinculado</span> : null}
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        </AdminCard>
      )}
    </div>
  );
}
