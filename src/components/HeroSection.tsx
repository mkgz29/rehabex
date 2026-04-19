import { useEffect, useState } from 'react';

import type { HeroSlide } from '../types/cms';

type HeroSectionProps = {
  slides: HeroSlide[];
};

type HeroSlideCardProps = {
  slide: HeroSlide;
};

function HeroSlideCard({ slide }: HeroSlideCardProps) {
  return (
    <div className="grid min-h-[520px] items-center gap-10 lg:min-h-[600px] lg:grid-cols-[minmax(0,1fr)_minmax(320px,480px)]">
      <div className="flex h-full items-center">
        <div className="max-w-2xl">
          <span className="brand-badge inline-flex rounded-full text-sm font-medium">Slide destacado</span>
          <h1 className="mt-6 max-w-xl text-4xl font-semibold tracking-tight text-slate-950 sm:text-5xl lg:text-6xl">
            {slide.title}
          </h1>
          <p className="mt-6 max-w-xl text-base leading-7 text-slate-600 sm:text-lg">{slide.subtitle}</p>
          <div className="mt-8 flex max-w-xl flex-col gap-3 sm:flex-row">
            <a
              href={slide.primaryButtonLink}
              className="brand-button inline-flex items-center justify-center rounded-full px-6 py-3 text-sm font-semibold"
            >
              {slide.primaryButtonText}
            </a>
            <a
              href={slide.secondaryButtonLink}
              className="inline-flex items-center justify-center rounded-full border border-slate-300 px-6 py-3 text-sm font-semibold text-slate-800 transition hover:border-slate-900 hover:bg-white"
            >
              {slide.secondaryButtonText}
            </a>
          </div>
        </div>
      </div>

      <div className="flex h-full items-center">
        <div className="w-full overflow-hidden rounded-[2rem] border border-white/70 bg-white/70 p-3 shadow-[0_24px_80px_rgba(15,23,42,0.16)] backdrop-blur">
          <div className="overflow-hidden rounded-[1.5rem]">
            <img src={slide.image} alt={slide.alt} className="h-[300px] w-full object-cover object-center lg:h-[400px]" />
          </div>
        </div>
      </div>
    </div>
  );
}

export function HeroSection({ slides }: HeroSectionProps) {
  const safeSlides = slides.slice(0, 3);
  const [activeSlide, setActiveSlide] = useState(0);

  useEffect(() => {
    if (safeSlides.length <= 1) {
      return;
    }

    const intervalId = window.setInterval(() => {
      setActiveSlide((current) => (current + 1) % safeSlides.length);
    }, 5000);

    return () => window.clearInterval(intervalId);
  }, [safeSlides.length]);

  useEffect(() => {
    if (activeSlide >= safeSlides.length) {
      setActiveSlide(0);
    }
  }, [activeSlide, safeSlides.length]);

  if (safeSlides.length === 0) {
    return null;
  }

  const slide = safeSlides[activeSlide];

  return (
    <section className="relative isolate overflow-hidden">
      <div
        className="absolute inset-0 top-0 -z-10 h-[28rem] lg:h-[32rem]"
        style={{
          background:
            'radial-gradient(circle at top left, rgba(234, 122, 31, 0.15), transparent 45%), linear-gradient(180deg, rgba(255, 255, 255, 0.8), rgba(245, 245, 244, 0.95))',
        }}
      />
      <div className="mx-auto w-full max-w-7xl px-4 py-14 sm:px-6 sm:py-20 lg:px-8 lg:py-24">
        <HeroSlideCard slide={slide} />

        {safeSlides.length > 1 ? (
          <div className="mt-8 flex items-center gap-3">
            <button
              type="button"
              onClick={() => setActiveSlide((current) => (current - 1 + safeSlides.length) % safeSlides.length)}
              className="brand-ring-button inline-flex h-11 w-11 items-center justify-center rounded-full border border-slate-300 bg-white text-slate-700"
              aria-label="Slide anterior"
            >
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8">
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 18l-6-6 6-6" />
              </svg>
            </button>
            <button
              type="button"
              onClick={() => setActiveSlide((current) => (current + 1) % safeSlides.length)}
              className="brand-ring-button inline-flex h-11 w-11 items-center justify-center rounded-full border border-slate-300 bg-white text-slate-700"
              aria-label="Slide siguiente"
            >
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 6l6 6-6 6" />
              </svg>
            </button>
            <div className="flex items-center gap-2">
              {safeSlides.map((heroSlide, index) => (
                <button
                  key={heroSlide.id}
                  type="button"
                  onClick={() => setActiveSlide(index)}
                  aria-label={`Ir al slide ${index + 1}`}
                  className={`h-2.5 rounded-full transition ${
                    index === activeSlide ? 'brand-dot-active w-8' : 'w-2.5 bg-slate-300 hover:bg-slate-400'
                  }`}
                />
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}
