import { ArrowUpRight } from 'lucide-react';
import { Link } from 'react-router-dom';

import { navLinks } from '../content/navigation';
import { getCategoryStoreHref } from '../lib/catalog';
import { PaymentMethods } from './PaymentMethods';

type SiteFooterProps = {
  categories?: string[];
};

export function SiteFooter({ categories = [] }: SiteFooterProps) {
  const visibleCategories = [...new Set(categories.map((category) => category.trim()).filter(Boolean))].slice(0, 5);

  return (
    <footer id="contacto" className="bg-primary text-white">
      <div className="site-container py-16 lg:py-20">
        <div className={`grid gap-12 border-b border-white/15 pb-12 lg:gap-14 lg:pb-16 ${visibleCategories.length > 0 ? 'lg:grid-cols-[1.35fr_0.65fr_0.8fr]' : 'lg:grid-cols-[1.4fr_0.6fr]'}`}>
          <div data-reveal-item className="max-w-lg">
            <img src="/brand/rehabex-logo-light.svg" alt="Rehabex" width="874" height="240" loading="lazy" className="h-9 w-auto sm:h-10" />
            <p className="mt-7 text-balance text-2xl font-semibold leading-tight tracking-[-0.025em] text-white sm:text-3xl">Equipamiento para acompañar cada etapa de tu recuperación.</p>
            <p className="mt-4 max-w-md text-sm leading-7 text-white/60">Una selección clara de productos para rehabilitación, movilidad y bienestar.</p>
          </div>

          <div data-reveal-item>
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-white/55">Explorar</p>
            <nav className="mt-4 flex flex-col items-start" aria-label="Navegación del pie">
              {navLinks.map((link) => (
                <Link key={link.href} to={link.href} className="group inline-flex min-h-11 min-w-11 items-center gap-1.5 text-sm font-semibold text-white/70 transition hover:text-accent-soft">
                  {link.label}
                  <ArrowUpRight className="h-3.5 w-3.5 opacity-0 transition group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:opacity-100" aria-hidden="true" />
                </Link>
              ))}
            </nav>
          </div>

          {visibleCategories.length > 0 ? (
            <div data-reveal-item>
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-white/55">Categorías</p>
              <nav className="mt-4 flex flex-col items-start" aria-label="Categorías en el pie">
                {visibleCategories.map((category) => (
                  <Link key={category} to={getCategoryStoreHref(category)} className="group inline-flex min-h-11 min-w-11 items-center gap-1.5 text-sm font-semibold text-white/70 transition hover:text-accent-soft">
                    {category}
                    <ArrowUpRight className="h-3.5 w-3.5 opacity-0 transition group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:opacity-100" aria-hidden="true" />
                  </Link>
                ))}
              </nav>
            </div>
          ) : null}
        </div>

        <div className="border-b border-white/15 py-6">
          <PaymentMethods />
        </div>

        <div className="flex flex-col gap-3 pt-6 text-xs text-white/55 sm:flex-row sm:items-center sm:justify-between">
          <p>© {new Date().getFullYear()} Rehabex. Todos los derechos reservados.</p>
          <p>Rehabilitación · Movilidad · Recuperación</p>
        </div>
      </div>
    </footer>
  );
}
