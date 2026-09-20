import type { Product } from '../types/cms';
import { CategoryCard } from './CategoryCard';
import { SectionHeading } from './SectionHeading';

type CategoriesSectionProps = { products: Product[] };

export function CategoriesSection({ products }: CategoriesSectionProps) {
  const categories = Array.from(
    products.reduce((entries, product) => {
      const category = product.category?.trim();
      if (!category) return entries;

      const current = entries.get(category);
      entries.set(category, {
        name: category,
        productCount: (current?.productCount ?? 0) + 1,
        imageUrl: current?.imageUrl || product.imageUrl,
        imageAlt: current?.imageAlt || product.name,
      });
      return entries;
    }, new Map<string, { name: string; productCount: number; imageUrl: string; imageAlt: string }>()),
  ).slice(0, 4);

  if (categories.length === 0) return null;

  return (
    <section className="section-shell bg-canvas" aria-labelledby="categories-title">
      <div className="site-container">
        <div id="categories-title">
          <SectionHeading eyebrow="Soluciones" title="Encontrá lo que necesitás para cada etapa" description="Explorá el catálogo a partir de las categorías disponibles en Rehabex." />
        </div>
        <div className="mt-9 grid gap-5 sm:grid-cols-2 md:grid-cols-3 lg:mt-11 lg:grid-cols-4">
          {categories.map(([, category]) => <CategoryCard key={category.name} {...category} />)}
        </div>
      </div>
    </section>
  );
}
