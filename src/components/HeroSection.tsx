import { useEffect, useState } from 'react';

import { heroSlides } from '../data/landing';

type HeroSlideCardProps = {
  badge: string;
  title: string;
  description: string;
  image: string;
  alt: string;
};

function HeroSlideCard({ badge, title, description, image, alt }: HeroSlideCardProps) {
  return (
    <div className="grid min-h-[520px] items-center gap-10 lg:min-h-[600px] lg:grid-cols-[minmax(0,1fr)_minmax(320px,480px)]">
      <div className="flex h-full items-center">
        <div className="max-w-2xl">
          <span className="brand-badge inline-flex rounded-full text-sm font-medium">
            {badge}
          </span>
          <h1 className="mt-6 max-w-xl text-4xl font-semibold tracking-tight text-slate-950 sm:text-5xl lg:text-6xl">
            {title}
          </h1>
          <p className="mt-6 max-w-xl text-base leading-7 text-slate-600 sm:text-lg">{description}</p>
          <div className="mt-8 flex max-w-xl flex-col gap-3 sm:flex-row">
            <a
              href="#productos"
              className="brand-button inline-flex items-center justify-center rounded-full px-6 py-3 text-sm font-semibold"
            >
              Ver productos destacados
            </a>
            <a
              href="#quienes-somos"
              className="inline-flex items-center justify-center rounded-full border border-slate-300 px-6 py-3 text-sm font-semibold text-slate-800 transition hover:border-slate-900 hover:bg-white"
            >
              Conocer REHABEX
            </a>
          </div>
        </div>
      </div>

      <div className="flex h-full items-center">
        <div className="w-full overflow-hidden rounded-[2rem] border border-white/70 bg-white/70 p-3 shadow-[0_24px_80px_rgba(15,23,42,0.16)] backdrop-blur">
          <div className="overflow-hidden rounded-[1.5rem]">
            <img src={image} alt={alt} className="h-[300px] w-full object-cover object-center lg:h-[400px]" />
          </div>
        </div>
      </div>
    </div>
  );
}

export function HeroSection() {
  const [activeSlide, setActiveSlide] = useState(0);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setActiveSlide((current) => (current + 1) % heroSlides.length);
    }, 5000);

    return () => window.clearInterval(intervalId);
  }, []);

  const slide = heroSlides[activeSlide];

  const goToPrevious = () => {
    setActiveSlide((current) => (current - 1 + heroSlides.length) % heroSlides.length);
  };

  const goToNext = () => {
    setActiveSlide((current) => (current + 1) % heroSlides.length);
  };

  return (
    <section className="relative isolate overflow-hidden">
      <div className="absolute inset-x-0 top-0 -z-10 h-[28rem] bg-[radial-gradient(circle_at_top_left,_rgba(16,185,129,0.18),_transparent_45%),linear-gradient(180deg,_rgba(255,255,255,0.7),_rgba(245,245,244,0.95))]" />
      <div className="mx-auto w-full max-w-7xl px-4 py-14 sm:px-6 sm:py-20 lg:px-8 lg:py-24">
        <HeroSlideCard
          badge={slide.badge}
          title={slide.title}
          description={slide.description}
          image={slide.image}
          alt={slide.alt}
        />

        <div className="mt-8 flex items-center gap-3">
          <button
            type="button"
            onClick={goToPrevious}
            className="brand-ring-button inline-flex h-11 w-11 items-center justify-center rounded-full border border-slate-300 bg-white text-slate-700"
            aria-label="Slide anterior"
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 18l-6-6 6-6" />
            </svg>
          </button>
          <button
            type="button"
            onClick={goToNext}
            className="brand-ring-button inline-flex h-11 w-11 items-center justify-center rounded-full border border-slate-300 bg-white text-slate-700"
            aria-label="Slide siguiente"
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 6l6 6-6 6" />
            </svg>
          </button>
          <div className="flex items-center gap-2">
            {heroSlides.map((heroSlide, index) => (
              <button
                key={heroSlide.title}
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
      </div>
    </section>
  );
}
