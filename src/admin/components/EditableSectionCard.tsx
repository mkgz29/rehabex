import type { ReactNode } from 'react';

type EditableSectionCardProps = {
  id: string;
  title: string;
  description: string;
  summary: ReactNode;
  isOpen: boolean;
  confirmation?: string | null;
  onToggle: () => void;
  children: ReactNode;
};

export function EditableSectionCard({
  id,
  title,
  description,
  summary,
  isOpen,
  confirmation,
  onToggle,
  children,
}: EditableSectionCardProps) {
  const contentId = `${id}-content`;

  return (
    <section className="overflow-hidden rounded-[1.75rem] border border-slate-200 bg-stone-50 shadow-sm shadow-slate-950/[0.02]">
      <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
          <p className="mt-1 text-sm leading-6 text-slate-600">{description}</p>
          {!isOpen ? <div className="mt-4">{summary}</div> : null}
          {!isOpen && confirmation ? (
            <p className="mt-3 text-sm font-medium text-emerald-700" role="status">
              {confirmation}
            </p>
          ) : null}
        </div>

        <button
          type="button"
          aria-expanded={isOpen}
          aria-controls={contentId}
          onClick={onToggle}
          className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-full border border-slate-300 bg-white px-5 py-2.5 text-sm font-semibold text-slate-800 transition hover:border-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] focus-visible:ring-offset-2"
        >
          {isOpen ? 'Cerrar' : 'Editar'}
        </button>
      </div>

      {isOpen ? (
        <div id={contentId} className="border-t border-slate-200 px-5 py-6 sm:px-6">
          {children}
        </div>
      ) : null}
    </section>
  );
}
