import { ArrowRight } from 'lucide-react';
import { Link } from 'react-router-dom';

import type { CatalogSectionContent } from '../types/cms';

type SupportCtaSectionProps = {
  content: CatalogSectionContent;
};

/** The closing dark CTA block on the landing page. Reconverted from the
 * original "Catálogo Rehabex" call-to-action (FASE 7C.1): same dark block,
 * same editable title/subtitle content shape (still content.catalogSection
 * -- renaming the settings key is out of scope for this phase), same
 * visual language, now pointing at the public Soporte intake form instead
 * of the store. */
export function SupportCtaSection({ content }: SupportCtaSectionProps) {
  return (
    <section className="bg-canvas pb-[var(--space-section)] pt-[var(--space-section-tight)]" aria-labelledby="support-cta-title">
      <div className="site-container">
        <div className="grid gap-8 rounded-card border border-white/10 bg-primary px-6 py-10 text-white shadow-soft sm:px-10 sm:py-12 lg:grid-cols-[1fr_auto] lg:items-center lg:gap-14 lg:px-14 lg:py-14">
          <div data-reveal-item>
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-accent-soft">Consultas Rehabex</p>
            <h2 id="support-cta-title" className="mt-5 text-balance text-3xl font-bold leading-tight tracking-[-0.035em] sm:text-4xl">{content.title}</h2>
            <p className="mt-4 max-w-xl text-sm leading-7 text-white/65 sm:text-base">{content.subtitle}</p>
          </div>

          <div data-reveal-item className="lg:justify-self-end">
            <Link to="/soporte" className="group inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-control bg-white px-6 text-sm font-bold text-primary transition duration-ui hover:bg-accent-soft sm:w-fit">
              Hacer una consulta
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" aria-hidden="true" />
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
