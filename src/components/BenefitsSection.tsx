import { benefits } from '../data/landing';
import { SectionHeading } from './SectionHeading';

export function BenefitsSection() {
  return (
    <section id="beneficios" className="bg-slate-950 px-4 py-16 text-white sm:px-6 lg:px-8 lg:py-24">
      <div className="mx-auto grid w-full max-w-7xl gap-10 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:items-start">
        <SectionHeading
          eyebrow="Beneficios"
          title="Una propuesta clara para profesionales, centros y pacientes"
          description="Trabajamos con foco en continuidad terapeutica, asesoramiento real y una experiencia de compra simple."
          theme="dark"
        />

        <div className="grid gap-4 sm:grid-cols-2">
          {benefits.map((benefit) => (
            <article key={benefit.title} className="rounded-[1.5rem] border border-white/10 bg-white/5 p-6">
              <div className="flex h-11 w-11 items-center justify-center rounded-full bg-emerald-500/20 text-emerald-300">
                <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.8">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <h3 className="mt-5 text-lg font-semibold text-white">{benefit.title}</h3>
              <p className="mt-2 text-sm leading-6 text-slate-300">{benefit.description}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
