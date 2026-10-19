import { useEffect, useRef, type CSSProperties, type ImgHTMLAttributes, type VideoHTMLAttributes } from 'react';

import { DEFAULT_FRAMING, framingToImageStyle, type ImageFraming } from '../../lib/imageFraming';

export type FramedMedia =
  | { kind: 'image'; url: string; framing?: ImageFraming }
  | { kind: 'video'; url: string; framing?: ImageFraming };

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
  autoPlay?: boolean;
  controls?: boolean;
  loop?: boolean;
  muted?: boolean;
  playsInline?: boolean;
  preload?: VideoHTMLAttributes<HTMLVideoElement>['preload'];
};

export function FramedImage({ media, alt, className, sizes, srcSet, width, height, loading, fetchPriority, onError, autoPlay, controls, loop, muted, playsInline, preload }: FramedImageProps) {
  const framing = media.framing ?? DEFAULT_FRAMING;
  const style = framingToImageStyle(framing);
  const cssStyle: CSSProperties = {
    objectFit: style.objectFit,
    objectPosition: style.objectPosition,
    transform: style.transform,
  };

  if (media.kind === 'video') {
    const videoStyle: CSSProperties = { ...cssStyle, objectFit: 'cover' };
    return (
      <FramedVideo
        url={media.url}
        label={alt}
        className={className}
        width={width}
        height={height}
        onError={onError}
        style={videoStyle}
        autoPlay={autoPlay}
        controls={controls}
        loop={loop}
        muted={muted}
        playsInline={playsInline}
        preload={preload}
      />
    );
  }

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

type FramedVideoProps = {
  url: string;
  label: string;
  className?: string;
  width?: number | string;
  height?: number | string;
  onError?: () => void;
  style: CSSProperties;
  autoPlay?: boolean;
  controls?: boolean;
  loop?: boolean;
  muted?: boolean;
  playsInline?: boolean;
  preload?: VideoHTMLAttributes<HTMLVideoElement>['preload'];
};

function FramedVideo({ url, label, className, width, height, onError, style, autoPlay = false, controls = false, loop = false, muted = true, playsInline = true, preload = 'metadata' }: FramedVideoProps) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (!autoPlay) {
      video.pause();
      return;
    }
    void video.play().catch(() => {
      // Autoplay is a progressive enhancement; the browser may still block it.
    });
  }, [autoPlay, url]);

  return (
    <video
      ref={videoRef}
      src={url}
      aria-label={label}
      width={width}
      height={height}
      autoPlay={autoPlay}
      controls={controls}
      loop={loop}
      muted={muted}
      playsInline={playsInline}
      preload={preload}
      onError={onError}
      style={style}
      className={className}
    />
  );
}
