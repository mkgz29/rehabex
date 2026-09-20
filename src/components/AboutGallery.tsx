import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';

import { getOptimizedImageUrl, getResponsiveImageSrcSet } from '../lib/image';

export type AboutGalleryItem = {
  imageUrl: string;
  alt: string;
  label: string;
};

type AboutGalleryProps = {
  items: AboutGalleryItem[];
};

export function AboutGallery({ items }: AboutGalleryProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [activeIndex, setActiveIndex] = useState(0);

  const goTo = (index: number) => {
    const nextIndex = Math.min(Math.max(index, 0), items.length - 1);
    const track = trackRef.current;
    const slide = trackRef.current?.children[nextIndex] as HTMLElement | undefined;
    if (!slide || !track) return;
    track.scrollTo({
      left: slide.offsetLeft - track.offsetLeft,
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
    });
    setActiveIndex(nextIndex);
  };

  const handleScroll = () => {
    const track = trackRef.current;
    if (!track) return;
    const slides = Array.from(track.children) as HTMLElement[];
    const closestIndex = slides.reduce((closest, slide, index) => (
      Math.abs((slide.offsetLeft - track.offsetLeft) - track.scrollLeft) < Math.abs((slides[closest].offsetLeft - track.offsetLeft) - track.scrollLeft) ? index : closest
    ), 0);
    setActiveIndex((current) => (current === closestIndex ? current : closestIndex));
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      goTo(activeIndex - 1);
    }
    if (event.key === 'ArrowRight') {
      event.preventDefault();
      goTo(activeIndex + 1);
    }
  };

  if (items.length === 0) return null;

  return (
    <div data-reveal-item>
      <div className="mb-4 flex items-end justify-between gap-4">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-white/55">Mirada Rehabex</p>
          <p className="mt-2 text-sm text-white/70">Productos y contextos vinculados con recuperación y movimiento.</p>
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={() => goTo(activeIndex - 1)} disabled={activeIndex === 0} className="inline-flex h-11 w-11 items-center justify-center rounded-control border border-white/20 text-white transition hover:border-white/45 hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-35" aria-label="Ver imagen anterior">
            <ChevronLeft className="h-5 w-5" aria-hidden="true" />
          </button>
          <button type="button" onClick={() => goTo(activeIndex + 1)} disabled={activeIndex === items.length - 1} className="inline-flex h-11 w-11 items-center justify-center rounded-control border border-white/20 text-white transition hover:border-white/45 hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-35" aria-label="Ver imagen siguiente">
            <ChevronRight className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>
      </div>

      <div
        ref={trackRef}
        className="editorial-gallery flex snap-x snap-mandatory gap-4 overflow-x-auto overscroll-x-contain pb-2"
        onScroll={handleScroll}
        onKeyDown={handleKeyDown}
        tabIndex={0}
        role="region"
        aria-label="Galería de Rehabex. Usá las flechas izquierda y derecha para navegar."
      >
        {items.map((item, index) => (
          <figure key={`${item.imageUrl}-${index}`} className="relative aspect-[4/3] basis-[88%] shrink-0 snap-start overflow-hidden rounded-card bg-primary-hover sm:basis-[76%] lg:basis-[82%]">
            <img
              src={getOptimizedImageUrl(item.imageUrl, { width: 1200 })}
              srcSet={getResponsiveImageSrcSet(item.imageUrl, [480, 720, 960, 1200])}
              sizes="(min-width: 1024px) 42vw, (min-width: 640px) 70vw, 82vw"
              alt={item.alt}
              width="1200"
              height="900"
              loading="lazy"
              decoding="async"
              className="h-full w-full object-cover object-center transition duration-500 ease-out hover:scale-[1.02]"
            />
            <figcaption className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-primary/90 via-primary/45 to-transparent px-5 pb-5 pt-16 text-sm font-semibold text-white">
              {item.label}
            </figcaption>
          </figure>
        ))}
      </div>

      <div className="mt-4 flex items-center justify-between gap-4">
        <div className="flex gap-1" aria-label={`Imagen ${activeIndex + 1} de ${items.length}`}>
          {items.map((item, index) => (
            <button key={`${item.imageUrl}-indicator`} type="button" onClick={() => goTo(index)} className="inline-flex h-11 w-11 items-center justify-center" aria-label={`Ir a la imagen ${index + 1}`} aria-current={index === activeIndex ? 'true' : undefined}>
              <span className={`h-1.5 rounded-full transition-all ${index === activeIndex ? 'w-7 bg-white' : 'w-3 bg-white/35'}`} aria-hidden="true" />
            </button>
          ))}
        </div>
        <p id="about-gallery-position" className="text-xs tabular-nums text-white/55" aria-live="polite">{activeIndex + 1} / {items.length}</p>
      </div>
    </div>
  );
}
