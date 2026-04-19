import { SectionHeading } from './SectionHeading';

export function AboutSection() {
  return (
    <section id="quienes-somos" className="px-4 py-16 sm:px-6 lg:px-8 lg:py-24">
      <div className="mx-auto grid w-full max-w-7xl gap-10 lg:grid-cols-[minmax(320px,440px)_minmax(0,1fr)] lg:items-center">
        <div className="overflow-hidden rounded-[2rem] border border-slate-200 bg-white p-3 shadow-sm">
          <img
            src="https://images.unsplash.com/photo-1516549655169-df83a0774514?auto=format&fit=crop&w=1200&q=80"
            alt="Equipo de trabajo especializado en rehabilitacion"
            className="h-[320px] w-full rounded-[1.5rem] object-cover object-center sm:h-[420px]"
          />
        </div>

        <div>
          <SectionHeading
            eyebrow="Quienes somos"
            title="REHABEX nace para acercar soluciones utiles, confiables y faciles de implementar"
            description="Somos un equipo enfocado en rehabilitacion y bienestar, con una mirada practica sobre lo que realmente necesita un tratamiento para sostenerse en el tiempo."
          />

          <div className="mt-8 grid gap-4 sm:grid-cols-2">
            <div className="brand-accent-soft rounded-[1.5rem] p-5">
              <p className="brand-accent-text text-3xl font-semibold">+500</p>
              <p className="mt-2 text-sm leading-6 text-slate-700">consultas atendidas con recomendacion personalizada.</p>
            </div>
            <div className="brand-accent-soft-strong rounded-[1.5rem] p-5">
              <p className="brand-accent-text text-3xl font-semibold">24/7</p>
              <p className="mt-2 text-sm leading-6 text-slate-700">foco en continuidad terapeutica y respuesta postventa.</p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
