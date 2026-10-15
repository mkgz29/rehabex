// Pure decision logic for the Product Card hover gallery -- no DOM, no
// React, no timers. The index-wrap math is intentionally the same function
// the Hero carousel already uses (src/lib/heroCarousel.ts): it's generic
// cycling arithmetic, not Hero-specific, so this reuses it instead of
// duplicating it.
import { clampSlideIndex, nextSlideIndex } from './heroCarousel';

export const PRODUCT_CARD_GALLERY_INTERVAL_MS = 1800;

export { nextSlideIndex as nextGalleryIndex, clampSlideIndex as clampGalleryIndex };

/**
 * The single gate everything else obeys: rotate only while the mouse is
 * actually over the card, there are at least 2 images to rotate between,
 * the visitor has not asked for reduced motion, and the device reports real
 * hover + a fine pointer (desktop with a mouse, not touch/coarse).
 */
export function shouldRotateGallery(options: { imageCount: number; isHovering: boolean; prefersReducedMotion: boolean; isHoverCapable: boolean }): boolean {
  return options.isHovering && options.imageCount >= 2 && !options.prefersReducedMotion && options.isHoverCapable;
}

/**
 * Reads the one media feature that matters here directly from the browser.
 * `(hover: hover) and (pointer: fine)` is true for a real mouse, false for
 * touch/coarse pointers (phones, tablets) -- exactly the "desktop only"
 * split the FASE spec asks for. Takes window.matchMedia as a parameter so
 * the decision this makes is injectable/testable without a real DOM.
 */
export function prefersHoverCapable(matchMediaImpl: typeof window.matchMedia | undefined): boolean {
  if (typeof matchMediaImpl !== 'function') return false;
  return matchMediaImpl('(hover: hover) and (pointer: fine)').matches;
}
