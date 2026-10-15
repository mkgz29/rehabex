import assert from 'node:assert/strict';
import test from 'node:test';

import { PRODUCT_CARD_GALLERY_INTERVAL_MS, clampGalleryIndex, nextGalleryIndex, prefersHoverCapable, shouldRotateGallery } from '../../src/lib/productCardGallery';

test('PRODUCT_CARD_GALLERY_INTERVAL_MS is exactly 1800ms, no other value', () => {
  assert.equal(PRODUCT_CARD_GALLERY_INTERVAL_MS, 1800);
});

// --- 1. a single image: never rotates, even while "hovering" -----------------

test('shouldRotateGallery: a 1-image (or 0-image) product never rotates, regardless of hover/motion/pointer', () => {
  assert.equal(shouldRotateGallery({ imageCount: 0, isHovering: true, prefersReducedMotion: false, isHoverCapable: true }), false);
  assert.equal(shouldRotateGallery({ imageCount: 1, isHovering: true, prefersReducedMotion: false, isHoverCapable: true }), false);
});

// --- 2. a 3-image product: index sequence over successive 1800ms ticks -------

test('a 3-image product cycles 0 -> 1 -> 2 -> 0 across successive 1800ms ticks (nextGalleryIndex applied 3 times)', () => {
  let index = 0;
  const atTick = [index];
  for (let tick = 0; tick < 3; tick += 1) {
    index = nextGalleryIndex(index, 3);
    atTick.push(index);
  }
  // t=0 (mouseenter): 0. t=1800ms: 1. t=3600ms: 2. t=5400ms: back to 0.
  assert.deepEqual(atTick, [0, 1, 2, 0]);
});

test('shouldRotateGallery is true only while hovering, with >= 2 images, no reduced motion, and hover-capable', () => {
  const allGood = { imageCount: 3, isHovering: true, prefersReducedMotion: false, isHoverCapable: true };
  assert.equal(shouldRotateGallery(allGood), true);
});

// --- 3. mouse leave: handled by the hook via isHovering -> false, resetting
// index to 0; see the CONTRACT test for the hook itself (no real timers to
// simulate without a DOM). Here, the pure effect of "leaving" is just: the
// gate flips off.
test('shouldRotateGallery turns off the moment isHovering is false (what mouse leave sets)', () => {
  assert.equal(shouldRotateGallery({ imageCount: 3, isHovering: false, prefersReducedMotion: false, isHoverCapable: true }), false);
});

// --- 6. prefers-reduced-motion: never rotates -------------------------------

test('shouldRotateGallery is false under prefers-reduced-motion, even with 3 images and real hover', () => {
  assert.equal(shouldRotateGallery({ imageCount: 3, isHovering: true, prefersReducedMotion: true, isHoverCapable: true }), false);
});

// --- 7. coarse pointer / no real hover (touch devices): never rotates --------

test('shouldRotateGallery is false when the device is not hover-capable (touch/coarse pointer)', () => {
  assert.equal(shouldRotateGallery({ imageCount: 3, isHovering: true, prefersReducedMotion: false, isHoverCapable: false }), false);
});

test('prefersHoverCapable reads exactly "(hover: hover) and (pointer: fine)" from the injected matchMedia, and is false when matchMedia is unavailable', () => {
  let queried: string | null = null;
  const fakeMatchMedia = ((query: string) => {
    queried = query;
    return { matches: true } as MediaQueryList;
  }) as typeof window.matchMedia;
  assert.equal(prefersHoverCapable(fakeMatchMedia), true);
  assert.equal(queried, '(hover: hover) and (pointer: fine)');

  const fakeCoarse = ((_query: string) => ({ matches: false }) as MediaQueryList) as typeof window.matchMedia;
  assert.equal(prefersHoverCapable(fakeCoarse), false);

  assert.equal(prefersHoverCapable(undefined), false);
});

// --- 12. clampGalleryIndex: never out of range when the gallery shrinks ------

test('clampGalleryIndex keeps the index in range when the gallery shrinks, and is 0 for an empty gallery', () => {
  assert.equal(clampGalleryIndex(2, 3), 2);
  assert.equal(clampGalleryIndex(2, 1), 0);
  assert.equal(clampGalleryIndex(0, 0), 0);
});
