import { ArrowUpRight, CreditCard, ShieldCheck } from 'lucide-react';
import { Link } from 'react-router-dom';

import logo from '../assets/logo.png';
import { navLinks } from '../content/navigation';

export function SiteFooter() {
  return (
    <footer id="contacto" className="bg-dark text-white">
      <div className="site-container section-shell">
        <div className="grid gap-12 border-b border-white/15 pb-12 lg:grid-cols-[1.25fr_0.75fr_0.8fr] lg:gap-16 lg:pb-16">
          <div className="max-w-lg">
            <img src={logo} alt="Rehabex" width="466" height="153" loading="lazy" className="h-11 w-auto object-contain brightness-0 invert" />
            <p className="mt-6 text-balance text-2xl font-semibold leading-tight tracking-[-0.025em] sm:text-3xl">Equipamiento para acompañar cada etapa de tu recuperación.</p>
            <p className="mt-4 max-w-md text-sm leading-7 text-white/65">Una selección clara de productos para rehabilitación, movilidad y bienestar.</p>
          </div>

          <div>
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-white/45">Explorar</p>
            <nav className="mt-5 flex flex-col items-start gap-3" aria-label="Navegación del pie">
              {navLinks.map((link) => (
                <Link key={link.href} to={link.href} className="group inline-flex min-h-7 items-center gap-1.5 text-sm font-semibold text-white/75 transition hover:text-white">
                  {link.label}
                  <ArrowUpRight className="h-3.5 w-3.5 opacity-0 transition group-hover:opacity-100" aria-hidden="true" />
                </Link>
              ))}
            </nav>
          </div>

          <div>
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-white/45">Compra</p>
            <div className="mt-5 space-y-4 text-sm text-white/70">
              <p className="flex items-start gap-3 leading-6"><CreditCard className="mt-0.5 h-4 w-4 shrink-0 text-brand" aria-hidden="true" />Pagos procesados mediante Mercado Pago.</p>
              <p className="flex items-start gap-3 leading-6"><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-brand" aria-hidden="true" />El stock se confirma al iniciar la compra.</p>
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-3 pt-6 text-xs text-white/45 sm:flex-row sm:items-center sm:justify-between">
          <p>© {new Date().getFullYear()} Rehabex. Todos los derechos reservados.</p>
          <p>Rehabilitación · Movilidad · Recuperación</p>
        </div>
      </div>
    </footer>
  );
}
