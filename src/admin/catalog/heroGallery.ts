import type { HeroImage } from '../../types/cms';

// Pure, framework-free carousel editing logic for the Hero admin form.
// Mirrors productGallery.ts's shape exactly (add/remove/replace/reorder),
// minus "isPrimary"/framing -- the hero carousel has no single "main" slide
// and no per-slide crop, just an ordered set of enabled/disabled images with
// an optional alt text. Array position is the display order while editing.
export type HeroGalleryDraftItem = { mediaAssetId: string | null; url: string; alt: string; enabled: boolean };

export const MAX_HERO_IMAGES = 8;
/** Below this many *enabled* slides, the Admin UI shows a (non-blocking) recommendation. */
export const RECOMMENDED_MIN_HERO_IMAGES = 3;

export function canAddMoreHeroImages(items: HeroGalleryDraftItem[]): boolean {
  return items.length < MAX_HERO_IMAGES;
}

export function addHeroImage(items: HeroGalleryDraftItem[], newItem: { mediaAssetId: string; url: string }): HeroGalleryDraftItem[] {
  if (!canAddMoreHeroImages(items)) return items;
  return [...items, { ...newItem, alt: '', enabled: true }];
}

export function removeHeroImageAt(items: HeroGalleryDraftItem[], index: number): HeroGalleryDraftItem[] {
  if (index < 0 || index >= items.length) return items;
  return items.filter((_, i) => i !== index);
}

export function replaceHeroImageAt(items: HeroGalleryDraftItem[], index: number, replacement: { mediaAssetId: string; url: string }): HeroGalleryDraftItem[] {
  if (index < 0 || index >= items.length) return items;
  return items.map((item, i) => (i === index ? { ...item, mediaAssetId: replacement.mediaAssetId, url: replacement.url } : item));
}

export function setHeroImageAltAt(items: HeroGalleryDraftItem[], index: number, alt: string): HeroGalleryDraftItem[] {
  if (index < 0 || index >= items.length) return items;
  return items.map((item, i) => (i === index ? { ...item, alt } : item));
}

export function toggleHeroImageEnabledAt(items: HeroGalleryDraftItem[], index: number): HeroGalleryDraftItem[] {
  if (index < 0 || index >= items.length) return items;
  return items.map((item, i) => (i === index ? { ...item, enabled: !item.enabled } : item));
}

function swap<T>(items: T[], a: number, b: number): T[] {
  const next = [...items];
  const temp = next[a];
  next[a] = next[b];
  next[b] = temp;
  return next;
}

export function moveHeroImageBefore(items: HeroGalleryDraftItem[], index: number): HeroGalleryDraftItem[] {
  if (index <= 0 || index >= items.length) return items;
  return swap(items, index, index - 1);
}

export function moveHeroImageAfter(items: HeroGalleryDraftItem[], index: number): HeroGalleryDraftItem[] {
  if (index < 0 || index >= items.length - 1) return items;
  return swap(items, index, index + 1);
}

export function reorderHeroImagesByDrag(items: HeroGalleryDraftItem[], fromIndex: number, toIndex: number): HeroGalleryDraftItem[] {
  if (fromIndex === toIndex || fromIndex < 0 || fromIndex >= items.length || toIndex < 0 || toIndex >= items.length) return items;
  const next = [...items];
  const [moved] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, moved);
  return next;
}

export function countEnabledHeroImages(items: HeroGalleryDraftItem[]): number {
  return items.filter((item) => item.enabled).length;
}

/** True when the admin should see the (non-blocking) "recommend at least 3" notice. */
export function shouldWarnFewHeroImages(items: HeroGalleryDraftItem[]): boolean {
  return countEnabledHeroImages(items) < RECOMMENDED_MIN_HERO_IMAGES;
}

export type HeroImagePayloadItem = { mediaAssetId: string; alt: string; enabled: boolean } | { legacyUrl: string; alt: string; enabled: boolean };

/** A legacy item (mediaAssetId null) round-trips by URL, same convention as productGallery's toGalleryPayload. */
export function toHeroImagesPayload(items: HeroGalleryDraftItem[]): HeroImagePayloadItem[] {
  return items.map(({ mediaAssetId, url, alt, enabled }) => (mediaAssetId ? { mediaAssetId, alt, enabled } : { legacyUrl: url, alt, enabled }));
}

export function heroImageToDraftItem(image: HeroImage): HeroGalleryDraftItem {
  return { mediaAssetId: image.mediaAssetId, url: image.url, alt: image.alt, enabled: image.enabled };
}
