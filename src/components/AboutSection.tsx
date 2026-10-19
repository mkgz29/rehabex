import { ArrowRight } from 'lucide-react';
import { Link } from 'react-router-dom';

import type { AboutContent, AboutMetric, Product } from '../types/cms';
import { AboutImageGrid } from './AboutImageGrid';
import type { AboutImageGridItem } from './AboutImageGrid';

type AboutSectionProps = {
  content: AboutContent;
  products: Product[];
  isLoading: boolean;
};

/** A metric with neither a value nor an explanation carries nothing to show -- rendering it would be an empty card, not "no invented data". */
function isMetricEmpty(metric: AboutMetric): boolean {
  return metric.value.trim() === '' && metric.label.trim() === '';
}

export function AboutSection({ content, products, isLoading }: AboutSectionProps) {
  const galleryItems = getGalleryItems(content, products);
  const visibleMetrics = content.metrics.filter((metric) => !isMetricEmpty(metric));

  return (
    <section id="quienes-somos" className="section-shell bg-primary text-white" aria-labelledby="about-title">
      <div className="site-container">
        <div className="grid items-center gap-12 lg:grid-cols-[0.82fr_1.18fr] lg:gap-16">
          <div data-reveal-item>
            <p className="flex items-center gap-2.5 text-xs font-bold uppercase tracking-[0.2em] text-white/60">
              <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[rgb(var(--color-stone))]" aria-hidden="true" />
              Acerca de Rehabex
            </p>
            {/* Editorial, not a billboard: two to four lines at every width.
                Kept mounted while loading (only its content swaps for a
                skeleton) so aria-labelledby="about-title" keeps a stable
                target and the old default text is never shown or announced. */}
            <h2 id="about-title" className="mt-5 max-w-[20ch] text-balance text-[clamp(1.875rem,3vw,3rem)] font-bold leading-[1.08] tracking-[-0.03em] text-white">
              {isLoading ? (
                <span className="inline-block w-full space-y-3" aria-hidden="true">
                  <span className="block h-[0.85em] w-full animate-pulse rounded bg-white/15" />
                  <span className="block h-[0.85em] w-2/3 animate-pulse rounded bg-white/15" />
                </span>
              ) : (
                content.title
              )}
            </h2>
            <div className="mt-7 max-w-xl space-y-4 text-base leading-7 text-white/70">
              {isLoading ? (
                <p className="space-y-2" aria-hidden="true">
                  <span className="block h-5 w-full animate-pulse rounded bg-white/15" />
                  <span className="block h-5 w-5/6 animate-pulse rounded bg-white/15" />
                </p>
              ) : (
                <p>{content.description}</p>
              )}
              <p>Reunimos productos y accesorios para quienes buscan acompañar rehabilitación, movilidad y bienestar con información clara, disponibilidad visible y una navegación directa.</p>
            </div>
            <Link to="/tienda" className="group mt-8 inline-flex min-h-11 items-center justify-center gap-2 rounded-control border border-white/25 px-5 py-3 text-sm font-bold text-white transition hover:border-white hover:bg-white hover:text-primary">
              Conocer el catálogo
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" aria-hidden="true" />
            </Link>
          </div>

          <AboutImageGrid items={galleryItems} />
        </div>

        {/* "Datos destacados": renders exactly what the admin configured in
            Editar página. A metric left fully empty is skipped; if every
            metric is empty the whole block disappears instead of leaving a
            hollow border on the page (ADMIN-02E). */}
        {!isLoading && visibleMetrics.length > 0 ? (
          <div className="mt-14 grid border-y border-white/15 sm:grid-cols-3 lg:mt-20" style={{ gridTemplateColumns: `repeat(${Math.min(visibleMetrics.length, 3)}, minmax(0, 1fr))` }}>
            {visibleMetrics.map((metric, index) => (
              <div key={metric.id} data-reveal-item className={`py-7 sm:px-6 lg:py-9 ${index > 0 ? 'border-t border-white/15 sm:border-l sm:border-t-0' : ''}`}>
                <p className="text-lg font-bold text-white">{metric.value}</p>
                <p className="mt-2 max-w-xs text-sm leading-6 text-white/60">{metric.label}</p>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </section>
  );
}

function getGalleryItems(content: AboutContent, products: Product[]) {
  const items: AboutImageGridItem[] = [];
  const seenUrls = new Set<string>();

  const addItem = (item: AboutImageGridItem) => {
    if (!item.imageUrl || seenUrls.has(item.imageUrl)) return;
    seenUrls.add(item.imageUrl);
    items.push(item);
  };

  addItem({
    imageUrl: content.image,
    mediaType: content.media_type,
    alt: 'Imagen editorial de Rehabex vinculada con rehabilitación y bienestar',
    label: 'Rehabilitación, movilidad y bienestar',
    framing: content.image_framing,
  });

  for (const product of products) {
    addItem({
      imageUrl: product.imageUrl,
      alt: product.name,
      label: product.name,
      framing: product.gallery?.find((image) => image.isPrimary)?.framing,
    });
    if (items.length === 3) break;
  }

  return items.slice(0, 3);
}
