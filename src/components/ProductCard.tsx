import { ArrowUpRight, ImageOff, ShoppingBag } from 'lucide-react';
import { Link } from 'react-router-dom';

import { formatCurrency } from '../lib/format';
import { getOptimizedImageUrl, getResponsiveImageSrcSet } from '../lib/image';
import type { Product } from '../types/cms';

type ProductCardProps = {
  product: Product;
  onAddToCart: (product: Product) => void;
  status?: 'idle' | 'added' | 'error';
};

export function ProductCard({ product, onAddToCart, status = 'idle' }: ProductCardProps) {
  const isOutOfStock = product.stockOnHand !== undefined && product.stockOnHand <= 0;
  const detailHref = `/productos/${product.id}`;

  return (
    <article data-reveal-item className="group flex min-h-full flex-col overflow-hidden rounded-card border border-line/90 bg-surface shadow-soft transition duration-ui hover:-translate-y-0.5 hover:border-accent/70 hover:shadow-card focus-within:shadow-card">
      <Link to={detailHref} className="relative block aspect-[4/5] overflow-hidden bg-canvas" aria-label={`Ver ${product.name}`}>
        {product.imageUrl ? (
          <img
            src={getOptimizedImageUrl(product.imageUrl, { width: 720 })}
            srcSet={getResponsiveImageSrcSet(product.imageUrl, [320, 480, 720])}
            sizes="(min-width: 1024px) 25vw, (min-width: 500px) 50vw, calc(100vw - 2rem)"
            alt={product.name}
            width="800"
            height="1000"
            loading="lazy"
            decoding="async"
            className="h-full w-full object-cover object-center transition duration-500 ease-out group-hover:scale-[1.025]"
          />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-muted">
            <ImageOff className="h-7 w-7" aria-hidden="true" />
            <span className="text-sm font-medium">Imagen no disponible</span>
          </div>
        )}
        {isOutOfStock ? <span className="absolute left-3 top-3 rounded-control bg-dark/90 px-2.5 py-1.5 text-xs font-bold text-white">Sin stock</span> : null}
      </Link>

      <div className="flex flex-1 flex-col p-5">
        {product.category ? <p className="truncate text-xs font-bold uppercase tracking-[0.16em] text-accent">{product.category}</p> : null}
        <h3 className="mt-2 min-h-12 text-lg font-bold leading-snug tracking-[-0.02em] text-ink">
          <Link to={detailHref} className="flex min-h-11 items-start rounded-sm transition hover:text-accent">
            <span className="line-clamp-2">{product.name}</span>
          </Link>
        </h3>
        <p className="mt-3 text-lg font-bold tabular-nums text-ink">{formatCurrency(product.price)}</p>
        <p className={`mt-2 min-h-5 text-xs font-semibold ${isOutOfStock ? 'text-muted' : product.stockOnHand !== undefined ? 'text-success' : 'text-muted'}`}>
          {isOutOfStock
            ? 'Sin stock actualmente'
            : product.stockOnHand !== undefined
              ? `Disponible · ${product.stockOnHand} en stock`
              : 'Disponibilidad a confirmar'}
        </p>

        <div className="mt-auto grid grid-cols-[1fr_auto] gap-2 pt-5">
          <button
            type="button"
            onClick={() => onAddToCart(product)}
            disabled={isOutOfStock}
            className="brand-button gap-2 px-3 disabled:cursor-not-allowed disabled:bg-line disabled:text-muted"
            aria-label={`Agregar ${product.name} al carrito`}
          >
            <ShoppingBag className="h-4 w-4" aria-hidden="true" />
            {isOutOfStock ? 'No disponible' : 'Agregar'}
          </button>
          <Link to={detailHref} className="secondary-button w-11 px-0" aria-label={`Ver detalle de ${product.name}`}>
            <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
          </Link>
        </div>

        <div className="min-h-6 pt-2 text-xs font-semibold" aria-live="polite" aria-atomic="true">
          {status === 'added' ? <p className="text-success">Agregado al carrito.</p> : null}
          {status === 'error' ? <p className="text-danger">No está disponible para agregar.</p> : null}
        </div>
      </div>
    </article>
  );
}
