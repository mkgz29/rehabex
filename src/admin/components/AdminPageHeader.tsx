import type { ReactNode } from 'react';

type AdminPageHeaderProps = {
  title: string;
  description: string;
  /** Quick-action links/buttons rendered alongside the title (e.g. AdminHomePage's quick links). Optional -- most pages have none. */
  actions?: ReactNode;
};

export function AdminPageHeader({ title, description, actions }: AdminPageHeaderProps) {
  return (
    <header className="border-b border-slate-200 pb-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight text-slate-950">{title}</h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">{description}</p>
        </div>
        {actions ? <div className="flex flex-wrap gap-3">{actions}</div> : null}
      </div>
    </header>
  );
}
