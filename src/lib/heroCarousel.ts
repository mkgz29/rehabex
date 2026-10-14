// Pure index arithmetic for the public Hero carousel. No DOM, no timers --
// the component (HeroCarousel.tsx) owns the autoplay interval, touch
// handling and reduced-motion check, and calls these for the actual index
// math so that math can be unit-tested without a browser.

/** Wraps forward: nextSlideIndex(2, 3) -> 0. length <= 1 always returns 0 (nothing to advance to). */
export function nextSlideIndex(current: number, length: number): number {
  if (length <= 1) return 0;
  return (current + 1) % length;
}

/** Wraps backward: prevSlideIndex(0, 3) -> 2. length <= 1 always returns 0. */
export function prevSlideIndex(current: number, length: number): number {
  if (length <= 1) return 0;
  return (current - 1 + length) % length;
}

/** Clamps a possibly-stale index (e.g. after the image list shrinks) into range; 0 for an empty list. */
export function clampSlideIndex(index: number, length: number): number {
  if (length <= 0) return 0;
  return Math.min(Math.max(index, 0), length - 1);
}

export const HERO_CAROUSEL_AUTOPLAY_MS = 5000;
/** Minimum horizontal drag distance (px) before a touch gesture counts as a swipe, not a tap. */
export const HERO_CAROUSEL_SWIPE_THRESHOLD_PX = 40;

/** Pure swipe-direction decision, so the touch handlers themselves stay thin. Returns null below the threshold (a tap, not a swipe). */
export function swipeDirection(deltaX: number): 'next' | 'prev' | null {
  if (Math.abs(deltaX) < HERO_CAROUSEL_SWIPE_THRESHOLD_PX) return null;
  return deltaX < 0 ? 'next' : 'prev';
}
