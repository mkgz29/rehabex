import { ImageOff } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

import { getOptimizedImageUrl, getResponsiveImageSrcSet } from '../lib/image';

type EditorialSplitProps = {
  eyebrow: string;
  title: string;
  description: string;
  imageUrl: string;
  imageAlt: string;
  ctaLabel?: string;
  ctaHref?: string;
  reversed?: boolean;
};

export function EditorialSplit({ eyebrow, title, description, imageUrl, imageAlt, ctaLabel, ctaHref, reversed = false }: EditorialSplitProps) {
  const [imageFailed, setImageFailed] = useState(false);

  useEffect(() => setImageFailed(false), [imageUrl]);

  return (
    <div className="site-container grid items-stretch gap-8 lg:grid-cols-2 lg:gap-12">
      <div className={`relative min-h-[22rem] overflow-hidden rounded-card bg-line sm:min-h-[30rem] ${reversed ? 'lg:order-2' : ''}`}>
        {!imageFailed && imageUrl ? (
          <img
            src={getOptimizedImageUrl(imageUrl, { width: 1200 })}
            srcSet={getResponsiveImageSrcSet(imageUrl, [480, 720, 960, 1200])}
            sizes="(min-width: 1024px) 50vw, calc(100vw - 2rem)"
            alt={imageAlt}
            width="1200"
            height="1000"
            loading="lazy"
            decoding="async"
            onError={() => setImageFailed(true)}
            className="absolute inset-0 h-full w-full object-cover object-center"
          />
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-surface text-muted">
            <ImageOff className="h-7 w-7" aria-hidden="true" />
            <span className="text-sm font-semibold">Imagen en preparación</span>
          </div>
        )}
      </div>
      <div className={`flex flex-col justify-center py-4 lg:px-8 lg:py-12 ${reversed ? 'lg:order-1' : ''}`}>
        <p className="eyebrow">{eyebrow}</p>
        <h2 className="mt-4 text-balance text-3xl font-bold leading-[1.08] tracking-[-0.04em] text-ink sm:text-4xl lg:text-5xl">{title}</h2>
        <p className="mt-6 max-w-xl whitespace-pre-line text-base leading-8 text-muted">{description}</p>
        {ctaLabel && ctaHref ? <Link to={ctaHref} className="secondary-button mt-8 w-fit">{ctaLabel}</Link> : null}
      </div>
    </div>
  );
}
