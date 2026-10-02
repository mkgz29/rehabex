import type { ComponentType, ReactNode, SVGProps } from 'react';

type AdminEmptyStateProps = {
  icon?: ComponentType<SVGProps<SVGSVGElement>>;
  title: string;
  description?: string;
  action?: ReactNode;
  /** Tighter padding/no icon for a small inline empty message (e.g. inside an already-bordered list). Default is the full treatment used by AdminProductsPage's true-empty state. */
  compact?: boolean;
};

/**
 * One empty-state treatment for /admin, replacing the three different ones
 * found across pages (full dashed box with icon+CTA, a bare paragraph, a
 * smaller dashed box with no icon).
 */
export function AdminEmptyState({ icon: Icon, title, description, action, compact = false }: AdminEmptyStateProps) {
  if (compact) {
    return (
      <div className="rounded-2xl border border-dashed border-slate-300 bg-stone-50 p-4 text-center text-sm text-slate-600">
        <p>{title}</p>
        {description ? <p className="mt-1 text-xs text-slate-500">{description}</p> : null}
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-slate-300 bg-stone-50 p-10 text-center">
      {Icon ? <Icon className="h-8 w-8 text-slate-400" aria-hidden="true" /> : null}
      <p className="text-sm font-medium text-slate-700">{title}</p>
      {description ? <p className="max-w-sm text-sm leading-6 text-slate-500">{description}</p> : null}
      {action ? <div className="mt-1">{action}</div> : null}
    </div>
  );
}
