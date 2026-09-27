import type { ProductImage } from '../../types/cms';

// Pure, framework-free gallery editing logic for the product form. Every
// function returns a new array that already satisfies the invariants the
// server enforces (at most 5 images, exactly one isPrimary when non-empty,
// no duplicate mediaAssetId) -- the UI can never construct an invalid
// intermediate state by calling these in sequence. Array position is the
// display order while editing; ProductImage.displayOrder is ignored here and
// recomputed fresh (as array position) whenever the draft is sent to the API.
export type GalleryDraftItem = ProductImage;

export const MAX_GALLERY_IMAGES = 5;

export function canAddMoreImages(items: GalleryDraftItem[]): boolean {
  return items.length < MAX_GALLERY_IMAGES;
}

export function addImage(items: GalleryDraftItem[], newItem: { mediaAssetId: string; url: string }): GalleryDraftItem[] {
  if (!canAddMoreImages(items)) return items;
  // The first image added to an empty gallery becomes primary automatically,
  // so the gallery is never left in the "non-empty but no primary" state a
  // save would otherwise reject.
  return [...items, { ...newItem, isPrimary: items.length === 0 }];
}

export function removeImageAt(items: GalleryDraftItem[], index: number): GalleryDraftItem[] {
  if (index < 0 || index >= items.length) return items;
  const removed = items[index];
  const next = items.filter((_, i) => i !== index);
  if (removed.isPrimary && next.length > 0 && !next.some((item) => item.isPrimary)) {
    next[0] = { ...next[0], isPrimary: true };
  }
  return next;
}

export function setPrimaryAt(items: GalleryDraftItem[], index: number): GalleryDraftItem[] {
  if (index < 0 || index >= items.length) return items;
  return items.map((item, i) => ({ ...item, isPrimary: i === index }));
}

export function replaceImageAt(items: GalleryDraftItem[], index: number, replacement: { mediaAssetId: string; url: string }): GalleryDraftItem[] {
  if (index < 0 || index >= items.length) return items;
  return items.map((item, i) => (i === index ? { ...item, mediaAssetId: replacement.mediaAssetId, url: replacement.url } : item));
}

function swap<T>(items: T[], a: number, b: number): T[] {
  const next = [...items];
  const temp = next[a];
  next[a] = next[b];
  next[b] = temp;
  return next;
}

/** "Mover antes": swaps with the previous item. No-op for the first item. */
export function moveBefore(items: GalleryDraftItem[], index: number): GalleryDraftItem[] {
  if (index <= 0 || index >= items.length) return items;
  return swap(items, index, index - 1);
}

/** "Mover después": swaps with the next item. No-op for the last item. */
export function moveAfter(items: GalleryDraftItem[], index: number): GalleryDraftItem[] {
  if (index < 0 || index >= items.length - 1) return items;
  return swap(items, index, index + 1);
}

export function reorderByDrag(items: GalleryDraftItem[], fromIndex: number, toIndex: number): GalleryDraftItem[] {
  if (fromIndex === toIndex || fromIndex < 0 || fromIndex >= items.length || toIndex < 0 || toIndex >= items.length) return items;
  const next = [...items];
  const [moved] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, moved);
  return next;
}

export type GalleryPayloadItem = { mediaAssetId: string; isPrimary: boolean } | { legacyUrl: string; isPrimary: boolean };

// A legacy item (mediaAssetId null -- carried over from before the gallery
// existed, RELEASE-ADMIN-02-PREFLIGHT backfill) is never issued a media asset
// id, so it round-trips by URL instead: the server only accepts a legacyUrl
// that already exists as a legacy row on this exact product, never a new one.
export function toGalleryPayload(items: GalleryDraftItem[]): GalleryPayloadItem[] {
  return items.map(({ mediaAssetId, url, isPrimary }) =>
    mediaAssetId ? { mediaAssetId, isPrimary } : { legacyUrl: url, isPrimary },
  );
}
