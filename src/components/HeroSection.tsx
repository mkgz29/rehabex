import { ArrowRight } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';

import { HeroCarousel } from './HeroCarousel';
import { DiagonalShapeDefs } from './media/DiagonalShapeDefs';
import type { HeroContent } from '../types/cms';

type HeroSectionProps = {
  heroContent: HeroContent;
  isLoading: boolean;
};

export function HeroSection({ heroContent, isLoading }: HeroSectionProps) {
  // Two clearly separated looks: a real photograph (kept clean) versus loading / no image / failed
  // image (the warm placeholder treatment). Only the second one gets the gradient and glow.
  const [currentImageFailed, setCurrentImageFailed] = useState(false);
  const showsPhoto = !isLoading && heroContent.images.length > 0 && !currentImageFailed;

  return (
    <section className="hero-section hex-hem hex-hem--hero overflow-hidden bg-canvas" aria-labelledby="hero-title">
      <DiagonalShapeDefs />
      <div className="site-container grid min-h-[calc(100svh-6.5rem)] items-center gap-9 py-10 md:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)] md:gap-10 md:py-12 md:min-h-0 lg:max-w-none lg:grid-cols-[minmax(0,46fr)_minmax(0,54fr)] lg:items-center lg:gap-0 lg:py-4 lg:pr-0 lg:pl-0 min-[1200px]:grid-cols-[minmax(0,45fr)_minmax(0,55fr)]">
        <div className="hero-copy max-w-2xl py-2 md:py-8 lg:max-w-none lg:self-center lg:py-0 lg:pr-10">
          {/* Same "stay mounted, swap only the content" rule as the h1 below:
              while loading, a skeleton -- never the old hardcoded text, and
              never a blank flash once loaded with an empty eyebrow. */}
          {isLoading ? (
            <span className="eyebrow hero-enter inline-block h-[1em] w-40 animate-pulse rounded bg-line" aria-hidden="true" />
          ) : heroContent.eyebrow ? (
            <p className="eyebrow hero-enter">{heroContent.eyebrow}</p>
          ) : null}
          {/* The h1/CTA stay mounted with their ids/elements while loading --
              only their content swaps for a skeleton -- so aria-labelledby
              keeps a stable target and no default/old CMS text is ever
              announced or painted before the real document resolves. */}
          <h1 id="hero-title" className="hero-enter hero-enter-delay-1 mt-5 max-w-[19ch] text-balance text-[clamp(2.75rem,5.2vw,4.5rem)] lg:text-[clamp(2.5rem,4.6vw,4rem)] font-bold leading-[0.98] tracking-[-0.05em] text-ink">
            {isLoading ? (
              <span className="inline-block w-full space-y-3" aria-hidden="true">
                <span className="block h-[0.85em] w-full animate-pulse rounded bg-line" />
                <span className="block h-[0.85em] w-2/3 animate-pulse rounded bg-line" />
              </span>
            ) : (
              heroContent.title
            )}
          </h1>
          {isLoading ? (
            <p className="hero-enter hero-enter-delay-2 mt-6 max-w-[34rem] space-y-2" aria-hidden="true">
              <span className="block h-5 w-full animate-pulse rounded bg-line" />
              <span className="block h-5 w-2/3 animate-pulse rounded bg-line" />
            </p>
          ) : heroContent.subtitle ? (
            <p className="hero-enter hero-enter-delay-2 mt-6 max-w-[34rem] text-base leading-7 text-muted sm:text-lg sm:leading-8">{heroContent.subtitle}</p>
          ) : null}
          <div className="hero-enter hero-enter-delay-3 mt-8 flex flex-wrap gap-3">
            {isLoading ? (
              <span className="inline-flex h-11 w-44 animate-pulse rounded-control bg-line" aria-hidden="true" />
            ) : (
              <a href={heroContent.primary_cta_link} className="brand-button gap-2 px-6">
                {heroContent.primary_cta_text}
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </a>
            )}
            <Link to="/tienda" className="secondary-button">Ver tienda</Link>
          </div>
        </div>

        <div
          className="hero-media hero-enter hero-enter-delay-4 relative aspect-[7/8] overflow-hidden rounded-card border border-brand/20 bg-line shadow-soft max-md:-mx-[var(--space-page)] max-md:rounded-none max-md:border-x-0 sm:aspect-[4/3] md:aspect-[4/5] lg:aspect-[11/6] lg:h-[clamp(24rem,38cqw,33.75rem)] lg:w-[calc(100%+3cqw)] lg:ml-[calc(-3cqw)] lg:-mt-3 lg:-mb-5 lg:self-end lg:rounded-none lg:border-0"
          aria-busy={isLoading}
        >
          <HeroCarousel images={heroContent.images} isLoading={isLoading} onCurrentImageFailed={setCurrentImageFailed} />
          {showsPhoto ? (
            // Real photograph: only a thin scrim at the bottom so the dots and badge stay legible.
            <div
              className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_top,rgb(var(--color-dark)/0.26),transparent_22%)]"
              aria-hidden="true"
            />
          ) : (
            <>
              {/* Placeholder look (loading, no image, failed image): warms the corner the hem hands over. */}
              <div
                className="pointer-events-none absolute inset-0 bg-gradient-to-t from-dark/25 via-transparent to-transparent ring-1 ring-inset ring-dark/5"
                aria-hidden="true"
              />
              <div
                className="pointer-events-none absolute inset-0 bg-[radial-gradient(64%_52%_at_92%_100%,rgb(var(--color-brand)/0.18),transparent_66%)]"
                aria-hidden="true"
              />
            </>
          )}
          <div className="absolute bottom-4 left-4 lg:left-10 inline-flex items-center gap-2 rounded-control border border-white/20 bg-primary/85 px-3 py-2 text-xs font-bold text-white backdrop-blur sm:bottom-6 sm:left-6">
            <span className="h-1.5 w-1.5 rounded-full bg-accent-soft" aria-hidden="true" />
            Selección Rehabex
          </div>
        </div>
      </div>
    </section>
  );
}
