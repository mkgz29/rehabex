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
    <section className="overflow-hidden bg-canvas">
      <div className="site-container grid min-h-[calc(100svh-6.5rem)] items-center gap-8 py-10 md:grid-cols-[minmax(0,0.88fr)_minmax(0,1.12fr)] md:gap-10 md:py-12 lg:gap-16 lg:py-16">
        <div className="max-w-xl py-4 md:py-10">
          <p className="eyebrow">Rehabilitación · Movilidad · Bienestar</p>
          <h1 className="mt-5 text-balance text-[clamp(2.75rem,7vw,5.75rem)] font-bold leading-[0.98] tracking-[-0.055em] text-ink">
            {heroContent.title}
          </h1>
          {heroContent.subtitle ? <p className="mt-6 max-w-lg text-base leading-7 text-muted sm:text-lg sm:leading-8">{heroContent.subtitle}</p> : null}
          <div className="mt-8 flex flex-wrap gap-3">
            <a href={heroContent.primary_cta_link} className="brand-button gap-2 px-6">
              {heroContent.primary_cta_text}
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </a>
            {heroContent.primary_cta_link !== '/tienda' ? <Link to="/tienda" className="secondary-button">Ver tienda</Link> : null}
          </div>
        </div>

        <div className="relative min-h-[24rem] overflow-hidden rounded-card bg-line md:min-h-[34rem] lg:min-h-[40rem]">
          {!imageFailed && heroContent.image_url ? (
            <img
              src={getOptimizedImageUrl(heroContent.image_url, { width: 1600 })}
              srcSet={getResponsiveImageSrcSet(heroContent.image_url, [640, 960, 1280, 1600])}
              sizes="(min-width: 768px) 55vw, calc(100vw - 2rem)"
              alt={heroContent.title}
              width="1600"
              height="1800"
              fetchPriority="high"
              decoding="async"
              onError={() => setImageFailed(true)}
              className="absolute inset-0 h-full w-full object-cover object-center"
            />
          ) : (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-[radial-gradient(circle_at_70%_20%,rgb(var(--color-brand)/0.12),transparent_45%),rgb(var(--color-surface))] text-muted">
              <ImageOff className="h-8 w-8" aria-hidden="true" />
              <p className="text-sm font-semibold">Imagen en preparación</p>
            </div>
          )}
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-dark/20 via-transparent to-transparent" aria-hidden="true" />
          <div className="absolute bottom-4 left-4 rounded-md border border-white/20 bg-dark/75 px-3 py-2 text-xs font-bold text-white backdrop-blur sm:bottom-6 sm:left-6">
            Selección Rehabex
          </div>
        </div>
      </div>
    </section>
  );
}
