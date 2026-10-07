import type { ComponentType, ReactNode, SVGProps } from 'react';

import { AdminCard } from './AdminCard';
import { AdminSectionHeading } from './AdminSectionHeading';

type EditableSectionCardProps = {
  id: string;
  title: string;
  description: string;
  icon?: ComponentType<SVGProps<SVGSVGElement>>;
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
  icon: Icon,
  summary,
  isOpen,
  confirmation,
  onToggle,
  children,
}: EditableSectionCardProps) {
  const contentId = `${id}-content`;

  return (
    // surface (white) while it shows real saved content; muted (stone) once
    // the form underneath is open, matching Productos/Pedidos' same rule.
    <AdminCard as="section" tone={isOpen ? 'muted' : 'surface'} padding="none" className="overflow-hidden shadow-sm shadow-slate-950/[0.02]">
      <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
        <div className="flex min-w-0 flex-1 items-start gap-3">
          {Icon ? (
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-stone-100 text-slate-700">
              <Icon aria-hidden="true" className="h-5 w-5" />
            </span>
          ) : null}
          <div className="min-w-0 flex-1">
            <AdminSectionHeading as="h3" title={title} description={description} />
            {!isOpen ? <div className="mt-4">{summary}</div> : null}
            {!isOpen && confirmation ? (
              <p className="mt-3 text-sm font-medium text-emerald-700" role="status">
                {confirmation}
              </p>
            ) : null}
          </div>
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
    </AdminCard>
  );
}
