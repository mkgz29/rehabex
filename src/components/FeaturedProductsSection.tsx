import { ArrowRight } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';

import { useCart } from '../cart/useCart';
import type { Product } from '../types/cms';
import { EmptyState } from './EmptyState';
import { ErrorState } from './ErrorState';
import { ProductGrid } from './ProductGrid';
import { SectionHeading } from './SectionHeading';

type FeaturedProductsSectionProps = {
  products: Product[];
  isLoading: boolean;
  error: string | null;
  onRetry: () => void;
};

export function FeaturedProductsSection({ products, isLoading, error, onRetry }: FeaturedProductsSectionProps) {
  const [productStatus, setProductStatus] = useState<{ id: string; status: 'added' | 'error' } | null>(null);
  const { addItem } = useCart();

  const handleAddToCart = (product: Product) => {
    const result = addItem({
      productId: product.id,
      name: product.name,
      price: product.price,
      imageUrl: product.imageUrl,
      availableStock: product.stockOnHand,
    });
    setProductStatus({ id: product.id, status: result === 'added' ? 'added' : 'error' });
    window.setTimeout(() => setProductStatus((current) => (current?.id === product.id ? null : current)), 2200);
  };

  return (
    // The second and last warm hem: the hand-off from this light block into the
    // Charcoal "Acerca de Rehabex" section below.
    <section id="productos" className="warm-hem warm-hem--ruled section-shell bg-surface" aria-labelledby="featured-products-title">
      <div className="site-container">
        <div className="flex flex-col gap-7 md:flex-row md:items-end md:justify-between">
          <div id="featured-products-title">
            <SectionHeading eyebrow="Productos destacados" title="Elegidos para acompañar tu recuperación" description="Conocé una selección del catálogo activo de Rehabex." />
          </div>
          <Link to="/tienda" className="secondary-button w-fit gap-2">
            Ver todo el catálogo
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Link>
        </div>

        <div className="mt-10 lg:mt-12">
          {error && !isLoading ? <ErrorState description={error} onRetry={onRetry} /> : null}
          {!error && !isLoading && products.length === 0 ? <EmptyState /> : null}
          {!error && (isLoading || products.length > 0) ? (
            <ProductGrid products={products} isLoading={isLoading} productStatus={productStatus} onAddToCart={handleAddToCart} />
          ) : null}
        </div>
      </div>
    </section>
  );
}
