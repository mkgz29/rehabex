import type { HeroContent } from '../types/cms';

type HeroSectionProps = {
  heroContent: HeroContent;
};

export function HeroSection({ heroContent }: HeroSectionProps) {
  return (
    <section className="relative isolate overflow-hidden bg-stone-950">
      <div className="relative min-h-[92vh] w-full sm:min-h-screen">
        <div
          className="hero-performance-bg absolute inset-0"
          style={{ backgroundImage: `url("${heroContent.image_url}")` }}
          aria-hidden="true"
        />
        <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(15,23,42,0.88)_0%,rgba(15,23,42,0.74)_30%,rgba(15,23,42,0.34)_58%,rgba(15,23,42,0.24)_100%)]" />
        <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(15,23,42,0.26)_0%,rgba(15,23,42,0.36)_38%,rgba(15,23,42,0.78)_100%)]" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(234,122,31,0.2),transparent_34%)]" />

        <div className="relative mx-auto flex min-h-[92vh] w-full max-w-7xl items-center px-4 pb-14 pt-28 sm:min-h-screen sm:px-6 sm:pb-16 sm:pt-32 lg:px-8">
          <div className="max-w-2xl">
            {/* <p className="text-xs font-medium uppercase tracking-[0.32em] text-white/70">REHABEX</p> */}
            <h1 className="mt-4 max-w-xl text-5xl font-semibold tracking-[-0.04em] text-white sm:text-6xl lg:text-7xl">
              {heroContent.title}
            </h1>
            {heroContent.subtitle ? (
              <p className="mt-5 max-w-lg text-base leading-7 text-white/80 sm:text-lg">{heroContent.subtitle}</p>
            ) : null}
            <div className="mt-8">
              <a
                href={heroContent.primary_cta_link}
                className="brand-button inline-flex min-h-12 items-center justify-center rounded-full px-7 py-3 text-sm font-semibold shadow-[0_20px_45px_rgba(234,122,31,0.28)]"
              >
                {heroContent.primary_cta_text}
              </a>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
