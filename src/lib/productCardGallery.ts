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

// --- Pure runtime engine ------------------------------------------------------
// useProductCardHoverGallery (the real React hook) is a thin wrapper around
// this: the hook owns the actual setInterval/useEffect wiring, this owns
// every state transition. Driving THIS directly (enter -> tick -> tick ->
// leave) is how tests exercise the real "does the index actually advance"
// behavior without a DOM or a timer -- not just checking that the right
// source strings exist. The hook and the tests both call the exact same
// functions, so a bug here cannot be "fixed in the test" without also
// fixing the real component.

export type GalleryEngineState = { index: number; isHovering: boolean };

export const INITIAL_GALLERY_ENGINE_STATE: GalleryEngineState = { index: 0, isHovering: false };

/** Mouse entered the card. Does not by itself start rotating -- shouldRotateGallery (checked by whoever drives ticks) still gates on imageCount/motion/pointer. */
export function enterGallery(state: GalleryEngineState): GalleryEngineState {
  return { ...state, isHovering: true };
}

/** Mouse left the card: stop and reset to the first slide immediately, same as onMouseLeave. */
export function leaveGallery(_state: GalleryEngineState): GalleryEngineState {
  return { ...INITIAL_GALLERY_ENGINE_STATE };
}

/** One 1800ms interval tick. A no-op if the gate says this shouldn't be rotating right now (mirrors the hook's effect bailing out instead of starting a timer). */
export function tickGallery(state: GalleryEngineState, imageCount: number, gate: { prefersReducedMotion: boolean; isHoverCapable: boolean }): GalleryEngineState {
  if (!shouldRotateGallery({ imageCount, isHovering: state.isHovering, ...gate })) return state;
  return { ...state, index: nextSlideIndex(state.index, imageCount) };
}
