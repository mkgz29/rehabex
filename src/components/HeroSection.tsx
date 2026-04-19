import type { HeroContent } from '../types/cms';

type HeroSectionProps = {
  heroContent: HeroContent;
};

export function HeroSection({ heroContent }: HeroSectionProps) {
  return (
    <section className="relative isolate overflow-hidden">
      <div
        className="absolute inset-0 top-0 -z-10 h-[28rem] lg:h-[32rem]"
        style={{
          background:
            'radial-gradient(circle at top left, rgba(234, 122, 31, 0.15), transparent 45%), linear-gradient(180deg, rgba(255, 255, 255, 0.8), rgba(245, 245, 244, 0.95))',
        }}
      />
      <div className="mx-auto grid min-h-[520px] w-full max-w-7xl items-center gap-10 px-4 py-14 sm:px-6 sm:py-20 lg:min-h-[600px] lg:grid-cols-[minmax(0,1fr)_minmax(320px,480px)] lg:px-8 lg:py-24">
        <div className="flex h-full items-center">
          <div className="max-w-2xl">
            {heroContent.badge ? (
              <span className="brand-badge inline-flex rounded-full text-sm font-medium">{heroContent.badge}</span>
            ) : null}
            <h1 className="mt-6 max-w-xl text-4xl font-semibold tracking-tight text-slate-950 sm:text-5xl lg:text-6xl">
              {heroContent.title}
            </h1>
            <p className="mt-6 max-w-xl text-base leading-7 text-slate-600 sm:text-lg">{heroContent.subtitle}</p>
            <div className="mt-8 flex max-w-xl flex-col gap-3 sm:flex-row">
              <a
                href={heroContent.primary_cta_link}
                className="brand-button inline-flex items-center justify-center rounded-full px-6 py-3 text-sm font-semibold"
              >
                {heroContent.primary_cta_text}
              </a>
              {heroContent.secondary_cta_text && heroContent.secondary_cta_link ? (
                <a
                  href={heroContent.secondary_cta_link}
                  className="inline-flex items-center justify-center rounded-full border border-slate-300 px-6 py-3 text-sm font-semibold text-slate-800 transition hover:border-slate-900 hover:bg-white"
                >
                  {heroContent.secondary_cta_text}
                </a>
              ) : null}
            </div>
          </div>
        </div>

        <div className="flex h-full items-center">
          <div className="w-full overflow-hidden rounded-[2rem] border border-white/70 bg-white/70 p-3 shadow-[0_24px_80px_rgba(15,23,42,0.16)] backdrop-blur">
            <div className="overflow-hidden rounded-[1.5rem]">
              <img
                src={heroContent.image_url}
                alt={heroContent.title}
                className="h-[300px] w-full object-cover object-center lg:h-[400px]"
              />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
