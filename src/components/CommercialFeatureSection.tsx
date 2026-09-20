import type { Product } from '../types/cms';
import { EditorialSplit } from './EditorialSplit';

type CommercialFeatureSectionProps = { product?: Product };

export function CommercialFeatureSection({ product }: CommercialFeatureSectionProps) {
  if (!product) return null;

  return (
    <section id="seleccion-destacada" className="bg-surface-muted pb-[var(--space-section-tight)] pt-[var(--space-section)]">
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
