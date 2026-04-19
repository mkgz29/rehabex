import { formatCurrency } from '../lib/format';
import type { Product } from '../types/cms';
import { SectionHeading } from './SectionHeading';

type FeaturedProductsSectionProps = {
  products: Product[];
};

export function FeaturedProductsSection({ products }: FeaturedProductsSectionProps) {
  return (
    <section id="productos" className="px-4 py-16 sm:px-6 lg:px-8 lg:py-24">
      <div className="mx-auto w-full max-w-7xl">
        <SectionHeading
          eyebrow="Productos destacados"
          title="Una seleccion pensada para recuperacion efectiva y uso diario"
          description="Combinamos funcionalidad, durabilidad y comodidad para que cada tratamiento tenga mejores resultados."
        />

        <div className="mt-10 grid gap-6 md:grid-cols-2 xl:grid-cols-3">
          {products.map((product) => (
            <article
              key={product.id}
              className="overflow-hidden rounded-[1.75rem] border border-slate-200 bg-white shadow-sm transition hover:-translate-y-1 hover:shadow-xl"
            >
              <img src={product.imageUrl} alt={product.name} className="h-64 w-full object-cover object-center" />
              <div className="p-6">
                <div className="flex items-start justify-between gap-4">
                  <h3 className="text-xl font-semibold text-slate-900">{product.name}</h3>
                  <span className="text-sm font-semibold text-slate-500">{formatCurrency(product.price)}</span>
                </div>
                <p className="mt-3 text-sm leading-6 text-slate-600">{product.description}</p>
                <a href="#contacto" className="brand-link mt-5 inline-flex text-sm font-semibold">
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
