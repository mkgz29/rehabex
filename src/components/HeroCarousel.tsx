import { ImageOff } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { usePrefersReducedMotion } from '../hooks/usePrefersReducedMotion';
import { getOptimizedImageUrl, getResponsiveImageSrcSet } from '../lib/image';
import { HERO_CAROUSEL_AUTOPLAY_MS, clampSlideIndex, nextSlideIndex, prevSlideIndex, swipeDirection } from '../lib/heroCarousel';
import type { ImageFraming } from '../lib/imageFraming';
import type { HeroImage } from '../types/cms';
import { FramedImage } from './media/FramedImage';

type HeroCarouselProps = {
  images: HeroImage[];
  isLoading: boolean;
  /** Same frame the single hero image used to carry; applied to every slide. */
  framing?: ImageFraming;
};

/**
 * The Hero's right-hand visual: a skeleton while CMS content is loading, the
 * existing "Imagen no configurada" fallback for 0 images, a plain static
 * image for exactly 1 (no controls over a single photo), and a full
 * autoplaying carousel for 2+. Mounted by HeroSection, which still owns the
 * aspect-ratio box and decorative overlays around it.
 */
export function HeroCarousel({ images, isLoading, framing }: HeroCarouselProps) {
  const [index, setIndex] = useState(0);
  const [isInteracting, setIsInteracting] = useState(false);
  const prefersReducedMotion = usePrefersReducedMotion();
  const touchStartX = useRef<number | null>(null);

  const safeIndex = clampSlideIndex(index, images.length);

  // Depending on `index` (not just mount) means any manual slide change --
  // autoplay's own tick, a dot click, or a swipe -- restarts the 5000ms
  // countdown from zero, exactly like a fresh autoplay cycle. isInteracting
  // (hover/focus) pauses it entirely while true.
  useEffect(() => {
    if (images.length < 2 || prefersReducedMotion || isInteracting) return;
    const timer = window.setInterval(() => setIndex((current) => nextSlideIndex(current, images.length)), HERO_CAROUSEL_AUTOPLAY_MS);
    return () => window.clearInterval(timer);
  }, [images.length, prefersReducedMotion, isInteracting, index]);

  if (isLoading) {
    return (
      <div className="absolute inset-0 bg-[rgb(var(--color-surface-muted))]">
        <span className="sr-only">Cargando imagen...</span>
      </div>
    );
  }

  if (images.length === 0) {
    return (
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-[radial-gradient(circle_at_70%_20%,rgb(var(--color-stone)/0.24),transparent_45%),rgb(var(--color-surface-muted))] text-muted">
        <ImageOff className="h-8 w-8" aria-hidden="true" />
        <p className="text-sm font-semibold">Imagen no configurada</p>
      </div>
    );
  }

  const current = images[safeIndex];

  const renderSlideImage = (image: HeroImage, index: number) => (
    <FramedImage
      key={image.mediaAssetId ?? image.url}
      media={{ kind: 'image', url: getOptimizedImageUrl(image.url, { width: 1600 }), framing }}
      srcSet={getResponsiveImageSrcSet(image.url, [640, 960, 1280, 1600])}
      sizes="(min-width: 768px) 55vw, calc(100vw - 2rem)"
      alt={image.alt || 'Equipo de rehabilitación seleccionado por Rehabex'}
      width={1600}
      height={1800}
      fetchPriority={index === 0 ? 'high' : 'low'}
      className="absolute inset-0 h-full w-full"
    />
  );

  if (images.length === 1) {
    return <div className="absolute inset-0">{renderSlideImage(current, 0)}</div>;
  }

  // No isInteracting here: a manual pick doesn't need a lasting pause, it
  // just needs the 5000ms countdown to restart -- which it does on its own,
  // since the autoplay effect above depends on `index`.
  const goTo = (next: number) => setIndex(next);

  return (
    <div
      className="absolute inset-0"
      role="region"
      aria-roledescription="carousel"
      aria-label="Imágenes destacadas de Rehabex"
      onMouseEnter={() => setIsInteracting(true)}
      onMouseLeave={() => setIsInteracting(false)}
      onFocus={() => setIsInteracting(true)}
      onBlur={() => setIsInteracting(false)}
      onTouchStart={(event) => {
        touchStartX.current = event.touches[0]?.clientX ?? null;
      }}
      onTouchEnd={(event) => {
        const startX = touchStartX.current;
        touchStartX.current = null;
        if (startX === null) return;
        const deltaX = (event.changedTouches[0]?.clientX ?? startX) - startX;
        const direction = swipeDirection(deltaX);
        if (direction === 'next') goTo(nextSlideIndex(safeIndex, images.length));
        else if (direction === 'prev') goTo(prevSlideIndex(safeIndex, images.length));
      }}
    >
      {images.map((image, i) => (
        <div key={image.mediaAssetId ?? image.url} aria-hidden={i !== safeIndex} className={i === safeIndex ? 'absolute inset-0' : 'absolute inset-0 opacity-0'} style={{ transition: prefersReducedMotion ? 'none' : 'opacity 400ms ease' }}>
          {renderSlideImage(image, i)}
        </div>
      ))}

      {/* Line indicators: the only manual navigation now (previous/next
          arrows removed by design). Active slide: fuller opacity + wider.
          Inactive: shorter + more subtle. */}
      <div className="absolute bottom-16 left-1/2 flex -translate-x-1/2 gap-2 sm:bottom-20">
        {images.map((image, i) => (
          <button
            key={image.mediaAssetId ?? image.url}
            type="button"
            aria-label={`Ir a la imagen ${i + 1} de ${images.length}`}
            aria-current={i === safeIndex}
            onClick={() => goTo(i)}
            className={`h-[3px] rounded-full transition-all focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand ${
              i === safeIndex ? 'w-8 bg-white' : 'w-5 bg-white/45 hover:bg-white/70'
            }`}
          />
        ))}
      </div>
    </div>
  );
}
