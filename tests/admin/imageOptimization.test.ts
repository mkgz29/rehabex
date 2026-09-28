import assert from 'node:assert/strict';
import test from 'node:test';

import { computeTargetDimensions, isTooSmall, pickOutputMimeType } from '../../src/lib/imageOptimization.ts';

// The canvas/createImageBitmap-driven parts of optimizeImageForUpload need a
// real browser DOM (no jsdom in this repo's test setup, matching every other
// upload-flow interaction here) and are covered by manual QA instead; these
// three pure functions carry all of its actual decision logic and are fully
// testable in isolation.

test('computeTargetDimensions never upscales a source already inside the ceiling', () => {
  assert.deepEqual(computeTargetDimensions(800, 600, 2400), { width: 800, height: 600 });
});

test('computeTargetDimensions downsizes the largest side to the ceiling, keeping aspect ratio', () => {
  assert.deepEqual(computeTargetDimensions(4800, 3600, 2400), { width: 2400, height: 1800 });
  assert.deepEqual(computeTargetDimensions(3600, 4800, 2400), { width: 1800, height: 2400 });
});

test('pickOutputMimeType keeps transparency by sending PNG to WebP, not JPEG', () => {
  assert.equal(pickOutputMimeType('image/png'), 'image/webp');
});

test('pickOutputMimeType sends every other source format to JPEG', () => {
  assert.equal(pickOutputMimeType('image/jpeg'), 'image/jpeg');
  assert.equal(pickOutputMimeType('image/webp'), 'image/jpeg');
});

test('isTooSmall flags anything under the minimum on either dimension', () => {
  assert.equal(isTooSmall(399, 1000), true);
  assert.equal(isTooSmall(1000, 399), true);
  assert.equal(isTooSmall(400, 400), false);
  assert.equal(isTooSmall(1000, 1000), false);
});
