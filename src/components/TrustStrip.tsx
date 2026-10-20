import { Award, Dumbbell, Headset, ListChecks, MousePointerClick, PackageCheck, ShieldCheck, Truck } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { usePrefersReducedMotion } from '../hooks/usePrefersReducedMotion';

const trustItems = [
  { icon: ShieldCheck, title: 'Pago seguro', text: 'Procesado mediante Mercado Pago.' },
  { icon: ListChecks, title: 'Información clara', text: 'Especificaciones principales de cada producto.' },
  { icon: PackageCheck, title: 'Stock visible', text: 'Disponibilidad actualizada en el catálogo.' },
  { icon: Award, title: 'Selección profesional', text: 'Equipamiento para rendimiento y recuperación.' },
  { icon: MousePointerClick, title: 'Compra simple', text: 'Un proceso directo, claro y sin pasos innecesarios.' },
  { icon: Headset, title: 'Atención personalizada', text: 'Contacto directo con el equipo Rehabex.' },
  { icon: Dumbbell, title: 'Equipamiento especializado', text: 'Soluciones pensadas para uso profesional y deportivo.' },
  { icon: Truck, title: 'Envíos coordinados', text: 'Opciones de entrega informadas durante la compra.' },
];

/** Below this width the strip is a swipeable carousel; from here up it is the desktop marquee (or a static grid under reduced motion). */
const CAROUSEL_QUERY = '(max-width: 1023px)';
const AUTOPLAY_MS = 4500;
/** After a manual swipe/scroll/focus the autoplay stays quiet for this long. */
const RESUME_AFTER_INTERACTION_MS = 9000;
/** Tolerance (px) for treating the scroller as being at its end. */
const END_TOLERANCE = 4;
/** Visual-only duplicates of the benefits (desktop marquee); with 8 cards, 2 copies cover screens up to ~5000px. Keep in sync with the CSS keyframes. */
export const MARQUEE_COPIES = 2;

/** Index of the slide whose left edge is closest to the current scroll position. */
export function nearestSlideIndex(offsets: number[], scrollLeft: number): number {
  let best = 0;
  offsets.forEach((offset, index) => {
    if (Math.abs(offset - scrollLeft) < Math.abs(offsets[best] - scrollLeft)) best = index;
  });
  return best;
}

/**
 * Slide the autoplay should move to next, or null when it must stop: on the
 * last available position it never wraps back to the start (no rewind).
 */
export function nextAutoplayIndex(current: number, count: number, atEnd: boolean): number | null {
  if (atEnd || count < 2 || current >= count - 1) return null;
  return current + 1;
}

function matchesCarouselQuery() {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(CAROUSEL_QUERY).matches;
}

export function TrustStrip() {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const lastInteractionRef = useRef(0);
  const hoveringRef = useRef(false);
  const prefersReducedMotion = usePrefersReducedMotion();
  const [isCarousel, setIsCarousel] = useState(matchesCarouselQuery);

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const query = window.matchMedia(CAROUSEL_QUERY);
    const update = () => setIsCarousel(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);

  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller || !isCarousel || prefersReducedMotion) return;

    let inView = true;
    const observer = 'IntersectionObserver' in window
      ? new IntersectionObserver(([entry]) => { inView = entry.isIntersecting; }, { threshold: 0.2 })
      : null;
    observer?.observe(scroller);

    let timer = 0;

    const advance = () => {
      if (document.hidden || !inView || hoveringRef.current) return;
      if (Date.now() - lastInteractionRef.current < RESUME_AFTER_INTERACTION_MS) return;

      const slides = Array.from(scroller.children) as HTMLElement[];
      const atEnd = scroller.scrollLeft + scroller.clientWidth >= scroller.scrollWidth - END_TOLERANCE;
      const current = nearestSlideIndex(slides.map((slide) => slide.offsetLeft), scroller.scrollLeft);
      const next = nextAutoplayIndex(current, slides.length, atEnd);
      if (next === null) {
        // Last position reached: autoplay is done. It never scrolls back to the start.
        window.clearInterval(timer);
        return;
      }
      scroller.scrollTo({ left: slides[next].offsetLeft, behavior: 'smooth' });
    };

    timer = window.setInterval(advance, AUTOPLAY_MS);
    return () => {
      window.clearInterval(timer);
      observer?.disconnect();
    };
  }, [isCarousel, prefersReducedMotion]);

  const markInteraction = () => {
    lastInteractionRef.current = Date.now();
  };

  return (
    <section className="trust-strip border-y border-white/10 bg-primary text-white" aria-label="Beneficios de comprar en Rehabex">
      <div className="trust-frame site-container">
        <div
          ref={scrollerRef}
          role="group"
          aria-label="Beneficios"
          tabIndex={isCarousel ? 0 : undefined}
          onPointerDown={markInteraction}
          onTouchStart={markInteraction}
          onWheel={markInteraction}
          onKeyDown={markInteraction}
          onFocus={markInteraction}
          onMouseEnter={() => { hoveringRef.current = true; }}
          onMouseLeave={() => { hoveringRef.current = false; markInteraction(); }}
          className="trust-scroller relative flex snap-x snap-mandatory overflow-x-auto overscroll-x-contain scroll-smooth focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent-soft lg:grid lg:grid-cols-4 lg:overflow-visible"
        >
          {trustItems.map(({ icon: Icon, title, text }, index) => (
            <div
              key={title}
              data-reveal-item
              className={`trust-item flex shrink-0 basis-[78%] snap-start gap-4 py-6 pr-4 sm:basis-[46%] lg:basis-auto lg:py-7 lg:pl-5 ${index > 0 ? 'border-l border-white/10 pl-5' : 'pl-0'}`}
            >
              <Icon className="trust-icon mt-0.5 h-5 w-5 shrink-0 text-accent-soft" strokeWidth={1.8} aria-hidden="true" />
              <div>
                <h2 className="trust-title text-sm font-bold text-white">{title}</h2>
                <p className="trust-text mt-1 text-xs leading-5 text-white/60 sm:text-sm">{text}</p>
              </div>
            </div>
          ))}

          {/*
            Desktop marquee only: purely visual copies that make the slow loop
            seamless. They are hidden everywhere else (display: none), carry
            aria-hidden, contain no links/focusable elements and no headings.
          */}
          {Array.from({ length: MARQUEE_COPIES }).flatMap((_, copy) =>
            trustItems.map(({ icon: Icon, title, text }) => (
              <div
                key={`copy-${copy}-${title}`}
                aria-hidden="true"
                data-reveal-item
                className="trust-item trust-copy shrink-0 gap-4 border-l border-white/10 py-6 pl-5 pr-4 lg:py-7"
              >
                <Icon className="trust-icon mt-0.5 h-5 w-5 shrink-0 text-accent-soft" strokeWidth={1.8} aria-hidden="true" />
                <div>
                  <p className="trust-title text-sm font-bold text-white">{title}</p>
                  <p className="trust-text mt-1 text-xs leading-5 text-white/60 sm:text-sm">{text}</p>
                </div>
              </div>
            )),
          )}
        </div>
      </div>
    </section>
  );
}
