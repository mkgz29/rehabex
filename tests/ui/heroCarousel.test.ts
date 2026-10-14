import assert from 'node:assert/strict';
import test from 'node:test';

import { HERO_CAROUSEL_AUTOPLAY_MS, HERO_CAROUSEL_SWIPE_THRESHOLD_PX, clampSlideIndex, nextSlideIndex, prevSlideIndex, swipeDirection } from '../../src/lib/heroCarousel';

test('HERO_CAROUSEL_AUTOPLAY_MS is exactly 5000ms', () => {
  assert.equal(HERO_CAROUSEL_AUTOPLAY_MS, 5000);
});

test('nextSlideIndex wraps forward and is a no-op for length <= 1', () => {
  assert.equal(nextSlideIndex(0, 3), 1);
  assert.equal(nextSlideIndex(2, 3), 0);
  assert.equal(nextSlideIndex(0, 1), 0);
  assert.equal(nextSlideIndex(0, 0), 0);
});

test('prevSlideIndex wraps backward and is a no-op for length <= 1', () => {
  assert.equal(prevSlideIndex(1, 3), 0);
  assert.equal(prevSlideIndex(0, 3), 2);
  assert.equal(prevSlideIndex(0, 1), 0);
  assert.equal(prevSlideIndex(0, 0), 0);
});

test('clampSlideIndex keeps an in-range index unchanged, clamps a stale one, and returns 0 for an empty list', () => {
  assert.equal(clampSlideIndex(1, 3), 1);
  assert.equal(clampSlideIndex(5, 3), 2);
  assert.equal(clampSlideIndex(-1, 3), 0);
  assert.equal(clampSlideIndex(0, 0), 0);
});

test('swipeDirection: below the threshold is a tap, not a swipe (null)', () => {
  assert.equal(swipeDirection(HERO_CAROUSEL_SWIPE_THRESHOLD_PX - 1), null);
  assert.equal(swipeDirection(0), null);
});

test('swipeDirection: a leftward drag (negative delta) means "next", rightward means "prev"', () => {
  assert.equal(swipeDirection(-100), 'next');
  assert.equal(swipeDirection(100), 'prev');
});
