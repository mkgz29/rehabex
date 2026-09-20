import { PackageOpen } from 'lucide-react';

type EmptyStateProps = {
  title?: string;
  description?: string;
};

export function EmptyState({
  title = 'Todavía no hay productos para mostrar',
  description = 'Volvé a visitarnos pronto para conocer las novedades del catálogo.',
}: EmptyStateProps) {
  return (
    <div className="flex min-h-64 flex-col items-center justify-center rounded-card border border-dashed border-line bg-surface px-6 py-12 text-center">
      <span className="flex h-12 w-12 items-center justify-center rounded-full bg-brand-soft text-brand-hover">
        <PackageOpen className="h-5 w-5" aria-hidden="true" />
      </span>
      <h3 className="mt-5 text-lg font-bold text-ink">{title}</h3>
      <p className="mt-2 max-w-md text-sm leading-6 text-muted">{description}</p>
    </div>
  );
}
