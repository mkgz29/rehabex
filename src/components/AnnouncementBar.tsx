import { ShieldCheck } from 'lucide-react';

export function AnnouncementBar() {
  return (
    <div className="bg-dark text-white">
      <div className="site-container flex min-h-8 items-center justify-center gap-2 py-1.5 text-center text-[0.6875rem] font-semibold tracking-[0.04em] sm:text-xs">
        <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-brand" aria-hidden="true" />
        <span>Pagos gestionados con Mercado Pago</span>
      </div>
    </div>
  );
}
