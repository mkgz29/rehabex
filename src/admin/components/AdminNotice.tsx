import type { ReactNode } from 'react';

type AdminNoticeProps = {
  children: ReactNode;
};

export function AdminNotice({ children }: AdminNoticeProps) {
  return (
    <div role="status" className="rounded-2xl border border-accent/30 bg-accent-soft px-4 py-3 text-sm leading-6 text-slate-700">
      {children}
    </div>
  );
}
