import type { CSSProperties, ImgHTMLAttributes } from 'react';

import { DEFAULT_FRAMING, framingToImageStyle, type ImageFraming } from '../../lib/imageFraming';

// Reusable public-facing media slot (portada, about, product images). Kept
// deliberately separate from any single page's markup: the container (the
// box, its aspect ratio, its overlays) and the media implementation (today
// always an <img>) are two different concerns, so a future `kind: 'video'`
// variant only has to add a sibling branch here, not rewrite HeroSection/
// AboutSection/ProductCard. Nothing "video" is added yet -- see the
// ADMIN-02E report for exactly what ADMIN-02F still needs.
export type FramedMedia = { kind: 'image'; url: string; framing?: ImageFraming };

type FramedImageProps = {
  media: FramedMedia;
  alt: string;
  className?: string;
  sizes?: string;
  srcSet?: string;
  width?: number | string;
  height?: number | string;
  loading?: ImgHTMLAttributes<HTMLImageElement>['loading'];
  fetchPriority?: 'high' | 'low' | 'auto';
  onError?: () => void;
};

export function FramedImage({ media, alt, className, sizes, srcSet, width, height, loading, fetchPriority, onError }: FramedImageProps) {
  const framing = media.framing ?? DEFAULT_FRAMING;
  const style = framingToImageStyle(framing);
  const cssStyle: CSSProperties = {
    objectFit: style.objectFit,
    objectPosition: style.objectPosition,
    transform: style.transform,
  };

  return (
    <img
      src={media.url}
      srcSet={srcSet}
      sizes={sizes}
      alt={alt}
      width={width}
      height={height}
      loading={loading}
      // eslint-disable-next-line react/no-unknown-property -- valid DOM attribute, just not yet in this TS lib's JSX types set
      fetchPriority={fetchPriority}
      decoding="async"
      onError={onError}
      style={cssStyle}
      className={className}
    />
  );
}
