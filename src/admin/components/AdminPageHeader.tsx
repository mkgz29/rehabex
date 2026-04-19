type AdminPageHeaderProps = {
  title: string;
  description: string;
};

export function AdminPageHeader({ title, description }: AdminPageHeaderProps) {
  return (
    <header className="border-b border-slate-200 pb-6">
      <h2 className="text-2xl font-semibold tracking-tight text-slate-950">{title}</h2>
      <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">{description}</p>
    </header>
  );
}
