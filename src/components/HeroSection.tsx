import { ArrowRight } from 'lucide-react';
import { Link } from 'react-router-dom';

import { HeroCarousel } from './HeroCarousel';
import type { HeroContent } from '../types/cms';

type HeroSectionProps = {
  heroContent: HeroContent;
  isLoading: boolean;
};

export function HeroSection({ heroContent, isLoading }: HeroSectionProps) {
  return (
    <section className="warm-hem warm-hem--drift overflow-hidden bg-canvas" aria-labelledby="hero-title">
      <div className="site-container grid min-h-[calc(100svh-6.5rem)] items-center gap-9 py-10 md:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)] md:gap-10 md:py-12 lg:gap-16 lg:py-14">
        <div className="max-w-2xl py-2 md:py-8">
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
          <h1 id="hero-title" className="hero-enter hero-enter-delay-1 mt-5 max-w-[19ch] text-balance text-[clamp(2.75rem,5.2vw,4.5rem)] font-bold leading-[0.98] tracking-[-0.05em] text-ink">
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
          className="hero-enter hero-enter-delay-4 relative aspect-[4/5] overflow-hidden rounded-card border border-brand/20 bg-line shadow-soft md:aspect-[4/5] lg:aspect-[6/5]"
          aria-busy={isLoading}
        >
          <HeroCarousel images={heroContent.images} isLoading={isLoading} />
          {/* Warms the corner the photograph hands over to the hem below, without
              tinting the product itself. */}
          <div
            className="pointer-events-none absolute inset-0 bg-gradient-to-t from-dark/25 via-transparent to-transparent ring-1 ring-inset ring-dark/5"
            aria-hidden="true"
          />
          <div
            className="pointer-events-none absolute inset-0 bg-[radial-gradient(64%_52%_at_92%_100%,rgb(var(--color-brand)/0.18),transparent_66%)]"
            aria-hidden="true"
          />
          <div className="absolute bottom-4 left-4 inline-flex items-center gap-2 rounded-control border border-white/20 bg-primary/85 px-3 py-2 text-xs font-bold text-white backdrop-blur sm:bottom-6 sm:left-6">
            <span className="h-1.5 w-1.5 rounded-full bg-accent-soft" aria-hidden="true" />
            Selección Rehabex
          </div>
        </div>
      </div>
    </section>
  );
}
