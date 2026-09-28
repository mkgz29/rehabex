import assert from 'node:assert/strict';
import test from 'node:test';

import { DEFAULT_FRAMING, framingToImageStyle, isDefaultFraming, normalizeFraming } from '../../src/lib/imageFraming.ts';

test('normalizeFraming returns the default for missing/invalid input', () => {
  assert.deepEqual(normalizeFraming(undefined), DEFAULT_FRAMING);
  assert.deepEqual(normalizeFraming(null), DEFAULT_FRAMING);
  assert.deepEqual(normalizeFraming('not-an-object'), DEFAULT_FRAMING);
  assert.deepEqual(normalizeFraming({}), DEFAULT_FRAMING);
});

test('normalizeFraming clamps out-of-range numbers instead of rejecting them', () => {
  assert.deepEqual(normalizeFraming({ mode: 'fill', focalX: -1, focalY: 2, zoom: 10 }), { mode: 'fill', focalX: 0, focalY: 1, zoom: 3 });
  assert.deepEqual(normalizeFraming({ mode: 'fill', focalX: 0.3, focalY: 0.7, zoom: 0 }), { mode: 'fill', focalX: 0.3, focalY: 0.7, zoom: 1 });
});

test('normalizeFraming falls back to "fill" for any mode other than "contain"', () => {
  assert.equal(normalizeFraming({ mode: 'contain' }).mode, 'contain');
  assert.equal(normalizeFraming({ mode: 'stretch' }).mode, 'fill');
  assert.equal(normalizeFraming({ mode: 123 }).mode, 'fill');
});

test('normalizeFraming accepts a fully valid object unchanged', () => {
  const value = { mode: 'contain' as const, focalX: 0.25, focalY: 0.75, zoom: 2 };
  assert.deepEqual(normalizeFraming(value), value);
});

test('isDefaultFraming only matches the exact centered/fill/normal-zoom default', () => {
  assert.equal(isDefaultFraming({ ...DEFAULT_FRAMING }), true);
  assert.equal(isDefaultFraming({ ...DEFAULT_FRAMING, zoom: 1.5 }), false);
  assert.equal(isDefaultFraming({ ...DEFAULT_FRAMING, mode: 'contain' }), false);
});

test('framingToImageStyle: "contain" always centers, ignoring focal point and zoom', () => {
  const style = framingToImageStyle({ mode: 'contain', focalX: 0.1, focalY: 0.9, zoom: 2 });
  assert.equal(style.objectFit, 'contain');
  assert.equal(style.objectPosition, '50% 50%');
  assert.equal(style.transform, undefined);
});

test('framingToImageStyle: "fill" uses the focal point as object-position and applies zoom as a transform', () => {
  const centered = framingToImageStyle({ mode: 'fill', focalX: 0.5, focalY: 0.5, zoom: 1 });
  assert.equal(centered.objectFit, 'cover');
  assert.equal(centered.objectPosition, '50% 50%');
  assert.equal(centered.transform, undefined, 'zoom 1 should not add a transform at all');

  const offCenterZoomed = framingToImageStyle({ mode: 'fill', focalX: 0.2, focalY: 0.8, zoom: 1.5 });
  assert.equal(offCenterZoomed.objectPosition, '20% 80%');
  assert.equal(offCenterZoomed.transform, 'scale(1.5)');
});
