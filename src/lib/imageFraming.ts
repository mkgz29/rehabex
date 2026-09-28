// Where an image is positioned within whatever box displays it (hero photo,
// about photo, one product gallery image). This is a property of the place
// the image is used, not of the file itself -- the same photo can be framed
// differently in different spots, and reframing never re-encodes or moves
// the underlying asset.
export type ImageFitMode = 'fill' | 'contain';

export type ImageFraming = {
  /** 'fill' ("Llenar el espacio"): may crop edges to cover the box. 'contain' ("Mostrar imagen completa"): shows the whole image, may leave empty space. */
  mode: ImageFitMode;
  /** 0..1, fraction from the left. 0.5 is centered. */
  focalX: number;
  /** 0..1, fraction from the top. 0.5 is centered. */
  focalY: number;
  /** >=1. 1 is the normal, unzoomed size. */
  zoom: number;
};

export const MIN_ZOOM = 1;
export const MAX_ZOOM = 3;

export const DEFAULT_FRAMING: ImageFraming = { mode: 'fill', focalX: 0.5, focalY: 0.5, zoom: 1 };

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Defensive parse: any missing/invalid field falls back to the matching default, never throws. */
export function normalizeFraming(value: unknown): ImageFraming {
  if (!value || typeof value !== 'object') return { ...DEFAULT_FRAMING };
  const raw = value as Record<string, unknown>;
  const mode: ImageFitMode = raw.mode === 'contain' ? 'contain' : 'fill';
  const focalX = typeof raw.focalX === 'number' && Number.isFinite(raw.focalX) ? clamp(raw.focalX, 0, 1) : DEFAULT_FRAMING.focalX;
  const focalY = typeof raw.focalY === 'number' && Number.isFinite(raw.focalY) ? clamp(raw.focalY, 0, 1) : DEFAULT_FRAMING.focalY;
  const zoom = typeof raw.zoom === 'number' && Number.isFinite(raw.zoom) ? clamp(raw.zoom, MIN_ZOOM, MAX_ZOOM) : DEFAULT_FRAMING.zoom;
  return { mode, focalX, focalY, zoom };
}

export function isDefaultFraming(framing: ImageFraming): boolean {
  return (
    framing.mode === DEFAULT_FRAMING.mode &&
    framing.focalX === DEFAULT_FRAMING.focalX &&
    framing.focalY === DEFAULT_FRAMING.focalY &&
    framing.zoom === DEFAULT_FRAMING.zoom
  );
}

/**
 * CSS for an <img> that fills its (positioned, overflow-hidden) container.
 * 'fill' uses object-fit: cover with the focal point as object-position, plus
 * an extra scale for zoom. 'contain' always shows the whole image centered;
 * zoom/focal point are not applied (there is no crop to reposition).
 */
export function framingToImageStyle(framing: ImageFraming): { objectFit: 'cover' | 'contain'; objectPosition: string; transform?: string } {
  if (framing.mode === 'contain') {
    return { objectFit: 'contain', objectPosition: '50% 50%' };
  }
  return {
    objectFit: 'cover',
    objectPosition: `${Math.round(framing.focalX * 100)}% ${Math.round(framing.focalY * 100)}%`,
    transform: framing.zoom !== 1 ? `scale(${framing.zoom})` : undefined,
  };
}
