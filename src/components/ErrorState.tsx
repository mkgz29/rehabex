import { AlertCircle, RotateCcw } from 'lucide-react';

type ErrorStateProps = {
  title?: string;
  description: string;
  onRetry?: () => void;
};

export function ErrorState({ title = 'No pudimos cargar esta sección', description, onRetry }: ErrorStateProps) {
  return (
    <div role="alert" className="flex min-h-64 flex-col items-center justify-center rounded-card border border-danger/20 bg-surface px-6 py-12 text-center">
      <span className="flex h-12 w-12 items-center justify-center rounded-full bg-danger/10 text-danger">
        <AlertCircle className="h-5 w-5" aria-hidden="true" />
      </span>
      <h3 className="mt-5 text-lg font-bold text-ink">{title}</h3>
      <p className="mt-2 max-w-md text-sm leading-6 text-muted">{description}</p>
      {onRetry ? (
        <button type="button" onClick={onRetry} className="secondary-button mt-5 gap-2">
          <RotateCcw className="h-4 w-4" aria-hidden="true" />
          Reintentar
        </button>
      ) : null}
    </div>
  );
}
