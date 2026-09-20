import { getOptimizedImageUrl, getResponsiveImageSrcSet } from '../lib/image';

export type AboutImageGridItem = {
  imageUrl: string;
  alt: string;
  label: string;
};

type AboutImageGridProps = {
  items: AboutImageGridItem[];
};

export function AboutImageGrid({ items }: AboutImageGridProps) {
  if (items.length === 0) return null;

  return (
    <div data-reveal-item>
      <div className="mb-5">
        <p className="text-xs font-bold uppercase tracking-[0.18em] text-white/60">Mirada Rehabex</p>
        <p className="mt-2 text-sm leading-6 text-white/70">Productos y contextos vinculados con recuperación y movimiento.</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,0.65fr)] lg:grid-rows-2" aria-label="Galería editorial de Rehabex">
        {items.map((item, index) => (
          <figure
            key={item.imageUrl}
            className={`relative overflow-hidden rounded-card bg-primary-hover ${index === 0 ? 'aspect-[4/3] sm:col-span-2 sm:aspect-[16/9] lg:col-span-1 lg:row-span-2 lg:aspect-auto' : 'aspect-[4/3]'}`}
          >
            <img
              src={getOptimizedImageUrl(item.imageUrl, { width: index === 0 ? 1200 : 720 })}
              srcSet={getResponsiveImageSrcSet(item.imageUrl, index === 0 ? [480, 720, 960, 1200] : [320, 480, 720])}
              sizes={index === 0 ? '(min-width: 1024px) 42vw, (min-width: 640px) 88vw, calc(100vw - 2rem)' : '(min-width: 1024px) 20vw, (min-width: 640px) 44vw, calc(100vw - 2rem)'}
              alt={item.alt}
              width={index === 0 ? 1200 : 720}
              height={index === 0 ? 900 : 540}
              loading="lazy"
              decoding="async"
              className="h-full w-full object-cover object-center transition duration-500 ease-out hover:scale-[1.02]"
            />
            <figcaption className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-primary/90 via-primary/45 to-transparent px-5 pb-5 pt-16 text-sm font-semibold text-white">
              {item.label}
            </figcaption>
          </figure>
        ))}
      </div>
    </div>
  );
}
