import type { ReactNode } from 'react';

type AdminNoticeProps = {
  children: ReactNode;
};

export function AdminNotice({ children }: AdminNoticeProps) {
  return (
    <div className="brand-accent-soft rounded-[1.5rem] border border-[var(--color-primary-border)] px-4 py-3 text-sm leading-6 text-slate-700">
      {children}
    </div>
  );
}
