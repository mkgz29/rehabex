import { ArrowRight, ImageOff } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

import { getOptimizedImageUrl, getResponsiveImageSrcSet } from '../lib/image';
import type { HeroContent } from '../types/cms';

type HeroSectionProps = {
  heroContent: HeroContent;
};

export function HeroSection({ heroContent }: HeroSectionProps) {
  const [imageFailed, setImageFailed] = useState(false);

  useEffect(() => setImageFailed(false), [heroContent.image_url]);

  return (
    <section className="overflow-hidden bg-canvas" aria-labelledby="hero-title">
      <div className="site-container grid min-h-[calc(100svh-6.5rem)] items-center gap-9 py-10 md:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)] md:gap-10 md:py-12 lg:gap-16 lg:py-14">
        <div className="max-w-2xl py-2 md:py-8">
          <p className="eyebrow hero-enter">Rehabilitación · Movilidad · Bienestar</p>
          <h1 id="hero-title" className="hero-enter hero-enter-delay-1 mt-5 max-w-[19ch] text-balance text-[clamp(2.75rem,5.2vw,4.5rem)] font-bold leading-[0.98] tracking-[-0.05em] text-ink">
            {heroContent.title}
          </h1>
          {heroContent.subtitle ? <p className="hero-enter hero-enter-delay-2 mt-6 max-w-[34rem] text-base leading-7 text-muted sm:text-lg sm:leading-8">{heroContent.subtitle}</p> : null}
          <div className="hero-enter hero-enter-delay-3 mt-8 flex flex-wrap gap-3">
            <a href={heroContent.primary_cta_link} className="brand-button gap-2 px-6">
              {heroContent.primary_cta_text}
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </a>
            <Link to="/tienda" className="secondary-button">Ver tienda</Link>
          </div>
        </div>

        <div className="hero-enter hero-enter-delay-4 relative aspect-[4/5] overflow-hidden rounded-card border border-line/80 bg-line shadow-soft md:aspect-[4/5] lg:aspect-[6/5]">
          {!imageFailed && heroContent.image_url ? (
            <img
              src={getOptimizedImageUrl(heroContent.image_url, { width: 1600 })}
              srcSet={getResponsiveImageSrcSet(heroContent.image_url, [640, 960, 1280, 1600])}
              sizes="(min-width: 768px) 55vw, calc(100vw - 2rem)"
              alt="Equipo de rehabilitación seleccionado por Rehabex"
              width="1600"
              height="1800"
              fetchPriority="high"
              decoding="async"
              onError={() => setImageFailed(true)}
              className="absolute inset-0 h-full w-full object-cover object-center"
            />
          ) : (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-[radial-gradient(circle_at_70%_20%,rgb(var(--color-stone)/0.24),transparent_45%),rgb(var(--color-surface-muted))] text-muted">
              <ImageOff className="h-8 w-8" aria-hidden="true" />
              <p className="text-sm font-semibold">Imagen en preparación</p>
            </div>
          )}
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-dark/25 via-transparent to-transparent ring-1 ring-inset ring-dark/5" aria-hidden="true" />
          <div className="absolute bottom-4 left-4 inline-flex items-center gap-2 rounded-control border border-white/20 bg-primary/85 px-3 py-2 text-xs font-bold text-white backdrop-blur sm:bottom-6 sm:left-6">
            <span className="h-1.5 w-1.5 rounded-full bg-accent-soft" aria-hidden="true" />
            Selección Rehabex
          </div>
        </div>
      </div>
    </section>
  );
}
