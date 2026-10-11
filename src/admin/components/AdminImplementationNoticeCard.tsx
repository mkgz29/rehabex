export type AdminImplementationNoticeCardProps = {
  title: string;
  message: string;
};

/**
 * Secondary, informational -- never styled like an error/warning alert.
 * Text only, rendered as normal React children (never dangerouslySetInnerHTML),
 * so a future Super Admin-authored notice can never inject arbitrary HTML.
 */
export function AdminImplementationNoticeCard({ title, message }: AdminImplementationNoticeCardProps) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-stone-50 px-4 py-3 sm:px-5">
      <p className="text-xs font-semibold text-slate-500">✨ Nueva implementación</p>
      <p className="mt-1 text-sm font-semibold text-slate-900">{title}</p>
      <p className="mt-1 text-sm leading-5 text-slate-600">{message}</p>
    </div>
  );
}
