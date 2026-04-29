import { useRef } from 'react';

import { formatCurrency } from '../lib/format';
import type { Product } from '../types/cms';

type FeaturedProductsSectionProps = {
  products: Product[];
};

export function FeaturedProductsSection({ products }: FeaturedProductsSectionProps) {
  const scrollerRef = useRef<HTMLDivElement>(null);

  const scrollCards = (direction: 'left' | 'right') => {
    const container = scrollerRef.current;
    if (!container) {
      return;
    }

    const amount = container.clientWidth * 0.82;
    container.scrollBy({
      left: direction === 'right' ? amount : -amount,
      behavior: 'smooth',
    });
  };

  return (
    <section id="productos" className="bg-[linear-gradient(180deg,#ffffff_0%,#f8fafc_100%)] px-4 py-16 sm:px-6 lg:px-8 lg:py-24">
      <div className="mx-auto w-full max-w-7xl">
        <div className="flex flex-col gap-8 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl">
            <p className="text-xs font-semibold uppercase tracking-[0.34em] text-slate-500">Productos destacados</p>
            <h2 className="mt-5 max-w-3xl text-4xl font-semibold tracking-[-0.045em] text-slate-950 sm:text-5xl lg:text-6xl">
              Un catalogo pensado para tratamientos reales y espacios profesionales
            </h2>
            <p className="mt-6 max-w-2xl text-base leading-7 text-slate-600 sm:text-lg">
              Seleccionamos equipos y accesorios con una presentacion mas visual, clara y lista para convertir interes en consulta.
            </p>
          </div>

          <div className="hidden items-center gap-3 lg:flex">
            <button
              type="button"
              onClick={() => scrollCards('left')}
              className="inline-flex h-12 w-12 items-center justify-center rounded-full border border-slate-300 bg-white text-slate-700 transition hover:border-slate-950 hover:text-slate-950"
              aria-label="Ver productos anteriores"
            >
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8">
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 6l-6 6 6 6" />
              </svg>
            </button>
            <button
              type="button"
              onClick={() => scrollCards('right')}
              className="inline-flex h-12 w-12 items-center justify-center rounded-full border border-slate-300 bg-white text-slate-700 transition hover:border-slate-950 hover:text-slate-950"
              aria-label="Ver productos siguientes"
            >
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 6l6 6-6 6" />
              </svg>
            </button>
          </div>
        </div>

        <div
          ref={scrollerRef}
          className="mt-10 flex snap-x snap-mandatory gap-6 overflow-x-auto pb-4 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden"
        >
          {products.map((product) => (
            <article
              key={product.id}
              className="group flex min-w-[84vw] snap-start flex-col overflow-hidden rounded-[2rem] border border-slate-200 bg-white shadow-[0_24px_70px_rgba(15,23,42,0.06)] transition hover:-translate-y-1 hover:shadow-[0_32px_90px_rgba(15,23,42,0.12)] sm:min-w-[28rem] lg:min-w-[24rem] xl:min-w-[26rem]"
            >
              <div className="relative aspect-[4/5] overflow-hidden bg-slate-100">
                <img
                  src={product.imageUrl}
                  alt={product.name}
                  className="h-full w-full object-cover object-center transition duration-500 group-hover:scale-[1.03]"
                />
                <div className="absolute inset-x-0 bottom-0 bg-[linear-gradient(180deg,rgba(15,23,42,0)_0%,rgba(15,23,42,0.62)_100%)] p-6">
                  <span className="inline-flex rounded-full bg-white/90 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-slate-700 backdrop-blur">
                    {formatCurrency(product.price)}
                  </span>
                </div>
              </div>

              <div className="flex flex-1 flex-col p-6">
                {product.category ? (
                  <p className="text-xs font-medium uppercase tracking-[0.24em] text-slate-500">{product.category}</p>
                ) : null}
                <h3 className="mt-3 text-2xl font-semibold tracking-[-0.03em] text-slate-950">{product.name}</h3>
                <p className="mt-3 line-clamp-3 text-sm leading-6 text-slate-600">{product.description}</p>
                <a href="#contacto" className="brand-link mt-6 inline-flex items-center gap-2 text-sm font-semibold">
                  Consultar disponibilidad
                  <span aria-hidden="true">{'->'}</span>
                </a>
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
