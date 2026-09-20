import type { Product } from '../types/cms';
import { ProductCard } from './ProductCard';
import { ProductCardSkeleton } from './ProductCardSkeleton';

type ProductGridProps = {
  products: Product[];
  isLoading?: boolean;
  productStatus?: { id: string; status: 'added' | 'error' } | null;
  onAddToCart: (product: Product) => void;
};

export function ProductGrid({ products, isLoading = false, productStatus, onAddToCart }: ProductGridProps) {
  const gridWidth = !isLoading && products.length === 3 ? 'md:max-w-[66rem] md:grid-cols-3' : 'lg:grid-cols-4';

  return (
    <div className={`grid grid-cols-1 gap-5 min-[500px]:grid-cols-2 lg:gap-6 ${gridWidth}`} aria-busy={isLoading}>
      {isLoading
        ? Array.from({ length: 4 }, (_, index) => <ProductCardSkeleton key={index} />)
        : products.map((product) => (
            <ProductCard
              key={product.id}
              product={product}
              onAddToCart={onAddToCart}
              status={productStatus?.id === product.id ? productStatus.status : 'idle'}
            />
          ))}
    </div>
  );
}
