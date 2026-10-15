import assert from 'node:assert/strict';
import test from 'node:test';

import { INITIAL_GALLERY_ENGINE_STATE, enterGallery, leaveGallery, tickGallery } from '../../src/lib/productCardGallery';

const HOVER_CAPABLE_DESKTOP = { prefersReducedMotion: false, isHoverCapable: true };

// --- the exact section 7 scenario: 3 real images, enter, tick x2, leave -----

test('REGRESSION (runtime behavior, not string-matching): a 3-image product actually advances through every slide on real enter+tick+tick, then resets on leave', () => {
  let state = INITIAL_GALLERY_ENGINE_STATE;
  assert.equal(state.index, 0, 'starts on the first (primary) slide');

  state = enterGallery(state);
  assert.equal(state.isHovering, true);

  // t = 1800ms
  state = tickGallery(state, 3, HOVER_CAPABLE_DESKTOP);
  assert.equal(state.index, 1, 'the visible slide actually changed to the second image');

  // t = 3600ms
  state = tickGallery(state, 3, HOVER_CAPABLE_DESKTOP);
  assert.equal(state.index, 2, 'advanced to the third image');

  // t = 5400ms: wraps back to the first
  state = tickGallery(state, 3, HOVER_CAPABLE_DESKTOP);
  assert.equal(state.index, 0);

  state = leaveGallery(state);
  assert.equal(state.index, 0);
  assert.equal(state.isHovering, false);
});

// --- THE REAL PRODUCTION BUG: a product with exactly 2 total images (the ---
// -- "TEST" product in prod: 1 primary + 1 secondary) must still rotate. ---

test('REGRESSION: a product with exactly 2 total images (1 primary + 1 secondary -- the real production case) rotates between them on hover', () => {
  let state = enterGallery(INITIAL_GALLERY_ENGINE_STATE);
  state = tickGallery(state, 2, HOVER_CAPABLE_DESKTOP);
  assert.equal(state.index, 1, 'with imageCount=2 (the TOTAL slide count, primary included), a single tick must reach the second image');
});

test('the old bug reproduced directly: passing only the SECONDARY count (1, for a 2-total-image product) never rotates -- this is exactly what ProductCard must not do', () => {
  let state = enterGallery(INITIAL_GALLERY_ENGINE_STATE);
  state = tickGallery(state, 1, HOVER_CAPABLE_DESKTOP); // the bug: imageCount=1 instead of 2
  assert.equal(state.index, 0, 'imageCount=1 never satisfies shouldRotateGallery\'s ">= 2" gate -- confirms why nothing changed in production before the fix');
});

// --- mouse leave resets immediately, mid-rotation -----------------------------

test('leaving mid-rotation (not on the first slide) resets to the first slide and stops', () => {
  let state = enterGallery(INITIAL_GALLERY_ENGINE_STATE);
  state = tickGallery(state, 3, HOVER_CAPABLE_DESKTOP);
  assert.equal(state.index, 1);
  state = leaveGallery(state);
  assert.deepEqual(state, { index: 0, isHovering: false });
});

// --- reduced motion / coarse pointer: ticks are no-ops, state never advances ---

test('a tick while prefers-reduced-motion is true never advances the index, even with 3 images and isHovering true', () => {
  let state = enterGallery(INITIAL_GALLERY_ENGINE_STATE);
  state = tickGallery(state, 3, { prefersReducedMotion: true, isHoverCapable: true });
  assert.equal(state.index, 0);
});

test('a tick on a coarse/no-hover device never advances the index', () => {
  let state = enterGallery(INITIAL_GALLERY_ENGINE_STATE);
  state = tickGallery(state, 3, { prefersReducedMotion: false, isHoverCapable: false });
  assert.equal(state.index, 0);
});

test('a tick while not hovering (e.g. a stray timer firing after leave) never advances the index', () => {
  const state = tickGallery(INITIAL_GALLERY_ENGINE_STATE, 3, HOVER_CAPABLE_DESKTOP);
  assert.equal(state.index, 0);
});

// --- a single-image product never advances, even if ticked -----------------

test('a 1-image product never advances on tick, even while hovering', () => {
  let state = enterGallery(INITIAL_GALLERY_ENGINE_STATE);
  state = tickGallery(state, 1, HOVER_CAPABLE_DESKTOP);
  assert.equal(state.index, 0);
});
