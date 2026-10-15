import { useEffect, useState } from 'react';

import { PRODUCT_CARD_GALLERY_INTERVAL_MS, clampGalleryIndex, nextGalleryIndex, prefersHoverCapable, shouldRotateGallery } from '../lib/productCardGallery';
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
 * A single setInterval effect, keyed on the one boolean that actually
 * toggles it (isHovering) plus the inputs that could change what it should
 * do (imageCount, prefersReducedMotion): entering sets isHovering, which
 * starts the effect; leaving clears isHovering, whose cleanup return stops
 * the interval -- there is never more than one interval alive, and nothing
 * in this hook calls setInterval anywhere else.
 */
export function useProductCardHoverGallery(imageCount: number) {
  const [index, setIndex] = useState(0);
  const [isHovering, setIsHovering] = useState(false);
  const prefersReducedMotion = usePrefersReducedMotion();

  // The gallery itself can change size (e.g. content reloads with fewer
  // images); never leave the index pointing past the end.
  useEffect(() => {
    setIndex((current) => clampGalleryIndex(current, imageCount));
  }, [imageCount]);

  useEffect(() => {
    const isHoverCapable = prefersHoverCapable(typeof window === 'undefined' ? undefined : window.matchMedia.bind(window));
    if (!shouldRotateGallery({ imageCount, isHovering, prefersReducedMotion, isHoverCapable })) return;

    const timer = window.setInterval(() => setIndex((current) => nextGalleryIndex(current, imageCount)), PRODUCT_CARD_GALLERY_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [imageCount, isHovering, prefersReducedMotion]);

  return {
    index,
    /** The gallery stack (secondary images) only ever mounts while actually hovering -- never preloaded up front, never kept mounted after leaving. */
    showGalleryStack: isHovering,
    onMouseEnter: () => setIsHovering(true),
    onMouseLeave: () => {
      setIsHovering(false);
      setIndex(0);
    },
  };
}
