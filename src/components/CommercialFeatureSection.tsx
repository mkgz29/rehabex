import type { Product } from '../types/cms';
import { EditorialSplit } from './EditorialSplit';

type CommercialFeatureSectionProps = { product?: Product };

export function CommercialFeatureSection({ product }: CommercialFeatureSectionProps) {
  if (!product) return null;

  return (
    <section className="section-shell bg-canvas">
      <EditorialSplit
        eyebrow="Selección destacada"
        title={product.name}
        description={product.description}
        imageUrl={product.imageUrl}
        imageAlt={product.name}
        ctaLabel="Ver producto"
        ctaHref={`/productos/${product.id}`}
        reversed
      />
    </section>
  );
}
