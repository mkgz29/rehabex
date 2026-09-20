import type { Product } from '../types/cms';
import { CategoryCard } from './CategoryCard';
import { SectionHeading } from './SectionHeading';

type CategoriesSectionProps = { products: Product[] };

export function CategoriesSection({ products }: CategoriesSectionProps) {
  const categories = Array.from(
    products.reduce((entries, product) => {
      const category = product.category?.trim();
      const isInternalCategory = category ? /^(test|prueba)$/i.test(category) : false;
      if (category && !isInternalCategory) entries.set(category, (entries.get(category) ?? 0) + 1);
      return entries;
    }, new Map<string, number>()),
  ).slice(0, 4);

  if (categories.length === 0) return null;

  return (
    <section className="section-shell bg-canvas" aria-labelledby="categories-title">
      <div className="site-container">
        <div id="categories-title">
          <SectionHeading eyebrow="Soluciones" title="Encontrá lo que necesitás para cada etapa" description="Explorá el catálogo a partir de las categorías disponibles en Rehabex." />
        </div>
        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {categories.map(([name, productCount], index) => <CategoryCard key={name} name={name} productCount={productCount} index={index} />)}
        </div>
      </div>
    </section>
  );
}
