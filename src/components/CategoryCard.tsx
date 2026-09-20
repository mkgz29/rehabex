import { ArrowUpRight, ImageOff } from 'lucide-react';
import { Link } from 'react-router-dom';

import { getCategoryStoreHref } from '../lib/catalog';
import { getOptimizedImageUrl, getResponsiveImageSrcSet } from '../lib/image';

type CategoryCardProps = {
  name: string;
  productCount: number;
  imageUrl: string;
  imageAlt: string;
};

export function CategoryCard({ name, productCount, imageUrl, imageAlt }: CategoryCardProps) {
  return (
    <Link data-reveal-item to={getCategoryStoreHref(name)} className="group overflow-hidden rounded-card border border-line/90 bg-surface shadow-soft transition duration-ui hover:-translate-y-0.5 hover:border-accent hover:shadow-card">
      <div className="aspect-[4/3] overflow-hidden bg-line/50">
        {imageUrl ? (
          <img
            src={getOptimizedImageUrl(imageUrl, { width: 640 })}
            srcSet={getResponsiveImageSrcSet(imageUrl, [320, 480, 640])}
            sizes="(min-width: 1024px) 25vw, (min-width: 640px) 50vw, calc(100vw - 2rem)"
            alt={imageAlt}
            width="640"
            height="480"
            loading="lazy"
            decoding="async"
            className="h-full w-full object-cover object-center transition duration-500 ease-out group-hover:scale-[1.025]"
          />
        ) : (
          <span className="flex h-full items-center justify-center text-muted">
            <ImageOff className="h-6 w-6" aria-hidden="true" />
          </span>
        )}
      </div>
      <div className="p-5">
        <p className="text-lg font-bold tracking-[-0.025em] text-ink">{name}</p>
        <div className="mt-2 flex items-center justify-between text-sm text-accent">
          <span>{productCount} {productCount === 1 ? 'producto' : 'productos'}</span>
          <ArrowUpRight className="h-4 w-4 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" aria-hidden="true" />
        </div>
      </div>
    </Link>
  );
}
