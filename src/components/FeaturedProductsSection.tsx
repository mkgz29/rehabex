import { featuredProducts } from '../data/landing';
import { SectionHeading } from './SectionHeading';

export function FeaturedProductsSection() {
  return (
    <section id="productos" className="px-4 py-16 sm:px-6 lg:px-8 lg:py-24">
      <div className="mx-auto w-full max-w-7xl">
        <SectionHeading
          eyebrow="Productos destacados"
          title="Una seleccion pensada para recuperacion efectiva y uso diario"
          description="Combinamos funcionalidad, durabilidad y comodidad para que cada tratamiento tenga mejores resultados."
        />

        <div className="mt-10 grid gap-6 md:grid-cols-2 xl:grid-cols-3">
          {featuredProducts.map((product) => (
            <article
              key={product.title}
              className="overflow-hidden rounded-[1.75rem] border border-slate-200 bg-white shadow-sm transition hover:-translate-y-1 hover:shadow-xl"
            >
              <img
                src={product.image}
                alt={product.title}
                className="h-64 w-full object-cover object-center"
              />
              <div className="p-6">
                <h3 className="text-xl font-semibold text-slate-900">{product.title}</h3>
                <p className="mt-3 text-sm leading-6 text-slate-600">{product.description}</p>
                <a href="#contacto" className="mt-5 inline-flex text-sm font-semibold text-emerald-700">
                  Consultar disponibilidad
                </a>
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
