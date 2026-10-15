import { useEffect, useState } from 'react';

import { INITIAL_GALLERY_ENGINE_STATE, PRODUCT_CARD_GALLERY_INTERVAL_MS, clampGalleryIndex, enterGallery, leaveGallery, prefersHoverCapable, shouldRotateGallery, tickGallery, type GalleryEngineState } from '../lib/productCardGallery';
import { usePrefersReducedMotion } from './usePrefersReducedMotion';

/**
 * Drives the Product Card's hover-only gallery preview: while the mouse is
 * over the card (the whole card, not just the image -- the caller puts
 * onMouseEnter/onMouseLeave on the <article>, not on the image), the shown
 * index advances every 1800ms; leaving resets to 0 and stops immediately.
 * Desktop-only (real hover + fine pointer) and respects
 * prefers-reduced-motion -- both gates live in shouldRotateGallery, so there
 * is exactly one place that decides "should this be rotating right now".
 *
 * `imageCount` is the TOTAL number of real visual slides for this product
 * (the primary image plus every secondary one) -- not just the secondary
 * count. Passing anything less undercounts and silently breaks rotation
 * (see the regression this hook's own tests cover: a product with its
 * primary image plus exactly one more photo has imageCount=2, which must
 * pass the ">= 2 images" gate on its own).
 *
 * Every state transition goes through the pure engine in
 * src/lib/productCardGallery.ts (enterGallery/leaveGallery/tickGallery) --
 * this hook only ever wires that engine to real DOM events and a real
 * setInterval; it owns no transition logic of its own, so the engine's own
 * tests exercise the exact same code path this hook runs.
 *
 * A single setInterval effect, keyed on the one boolean that actually
 * toggles it (isHovering) plus the inputs that could change what it should
 * do (imageCount, prefersReducedMotion): entering sets isHovering, which
 * starts the effect; leaving clears isHovering, whose cleanup return stops
 * the interval -- there is never more than one interval alive, and nothing
 * in this hook calls setInterval anywhere else.
 */
export function useProductCardHoverGallery(imageCount: number) {
  const [state, setState] = useState<GalleryEngineState>(INITIAL_GALLERY_ENGINE_STATE);
  const prefersReducedMotion = usePrefersReducedMotion();

  // The gallery itself can change size (e.g. content reloads with fewer
  // images); never leave the index pointing past the end.
  useEffect(() => {
    setState((current) => ({ ...current, index: clampGalleryIndex(current.index, imageCount) }));
  }, [imageCount]);

  useEffect(() => {
    const isHoverCapable = prefersHoverCapable(typeof window === 'undefined' ? undefined : window.matchMedia.bind(window));
    if (!shouldRotateGallery({ imageCount, isHovering: state.isHovering, prefersReducedMotion, isHoverCapable })) return;

    const timer = window.setInterval(() => setState((current) => tickGallery(current, imageCount, { prefersReducedMotion, isHoverCapable })), PRODUCT_CARD_GALLERY_INTERVAL_MS);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- state.isHovering (not the whole `state` object) is the only piece of state this effect needs to react to; `state.index` changing every tick must never restart the interval.
  }, [imageCount, state.isHovering, prefersReducedMotion]);

  return {
    index: state.index,
    /** The gallery stack (secondary images) only ever mounts while actually hovering -- never preloaded up front, never kept mounted after leaving. */
    showGalleryStack: state.isHovering,
    onMouseEnter: () => setState((current) => enterGallery(current)),
    onMouseLeave: () => setState((current) => leaveGallery(current)),
  };
}
