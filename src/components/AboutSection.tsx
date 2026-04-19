import type { AboutContent } from '../types/cms';
import { SectionHeading } from './SectionHeading';

type AboutSectionProps = {
  content: AboutContent;
};

export function AboutSection({ content }: AboutSectionProps) {
  return (
    <section id="quienes-somos" className="px-4 py-16 sm:px-6 lg:px-8 lg:py-24">
      <div className="mx-auto grid w-full max-w-7xl gap-10 lg:grid-cols-[minmax(320px,440px)_minmax(0,1fr)] lg:items-center">
        <div className="overflow-hidden rounded-[2rem] border border-slate-200 bg-white p-3 shadow-sm">
          <img
            src={content.image}
            alt="Equipo de trabajo especializado en rehabilitacion"
            className="h-[320px] w-full rounded-[1.5rem] object-cover object-center sm:h-[420px]"
          />
        </div>

        <div>
          <SectionHeading eyebrow="Quienes somos" title={content.title} description={content.description} />

          <div className="mt-8 grid gap-4 sm:grid-cols-2">
            {content.metrics.map((metric, index) => (
              <div
                key={metric.id}
                className={`${index === 0 ? 'brand-accent-soft' : 'brand-accent-soft-strong'} rounded-[1.5rem] p-5`}
              >
                <p className="brand-accent-text text-3xl font-semibold">{metric.value}</p>
                <p className="mt-2 text-sm leading-6 text-slate-700">{metric.label}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
