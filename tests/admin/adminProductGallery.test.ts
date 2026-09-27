import assert from 'node:assert/strict';
import test from 'node:test';

import {
  MAX_GALLERY_IMAGES,
  addImage,
  canAddMoreImages,
  moveAfter,
  moveBefore,
  removeImageAt,
  reorderByDrag,
  replaceImageAt,
  setPrimaryAt,
  toGalleryPayload,
  type GalleryDraftItem,
} from '../../src/admin/catalog/productGallery.ts';

function item(mediaAssetId: string, isPrimary = false): GalleryDraftItem {
  return { mediaAssetId, url: `https://images.example.test/${mediaAssetId}.jpg`, isPrimary };
}

// --- addImage ------------------------------------------------------------------

test('addImage appends and marks the very first image primary automatically', () => {
  const withFirst = addImage([], { mediaAssetId: 'a', url: 'https://images.example.test/a.jpg' });
  assert.equal(withFirst.length, 1);
  assert.equal(withFirst[0].isPrimary, true);

  const withSecond = addImage(withFirst, { mediaAssetId: 'b', url: 'https://images.example.test/b.jpg' });
  assert.equal(withSecond.length, 2);
  assert.equal(withSecond[1].isPrimary, false, 'a second image must not silently steal primary status');
});

test('addImage refuses a 6th image, keeping the gallery at the 5-image maximum', () => {
  const full = Array.from({ length: MAX_GALLERY_IMAGES }, (_, i) => item(`id-${i}`, i === 0));
  const attempted = addImage(full, { mediaAssetId: 'overflow', url: 'https://images.example.test/overflow.jpg' });
  assert.equal(attempted.length, MAX_GALLERY_IMAGES);
  assert.equal(canAddMoreImages(full), false);
  assert.equal(canAddMoreImages(attempted.slice(0, MAX_GALLERY_IMAGES - 1)), true);
});

// --- removeImageAt ---------------------------------------------------------------

test('removeImageAt reassigns primary to the first remaining image when the primary is removed', () => {
  const items = [item('a', true), item('b'), item('c')];
  const next = removeImageAt(items, 0);
  assert.equal(next.length, 2);
  assert.equal(next[0].mediaAssetId, 'b');
  assert.equal(next[0].isPrimary, true, 'the first remaining image must become primary');
});

test('removeImageAt leaves the gallery with zero images and no primary when the last one is removed', () => {
  const next = removeImageAt([item('a', true)], 0);
  assert.deepEqual(next, []);
});

test('removeImageAt does not disturb the existing primary when a non-primary image is removed', () => {
  const items = [item('a', true), item('b'), item('c')];
  const next = removeImageAt(items, 1);
  assert.equal(next.length, 2);
  assert.equal(next.find((i) => i.isPrimary)?.mediaAssetId, 'a');
});

// --- setPrimaryAt ----------------------------------------------------------------

test('setPrimaryAt always leaves exactly one primary image', () => {
  const items = [item('a', true), item('b'), item('c')];
  const next = setPrimaryAt(items, 2);
  assert.deepEqual(
    next.map((i) => i.isPrimary),
    [false, false, true],
  );
});

// --- replaceImageAt --------------------------------------------------------------

test('replaceImageAt swaps only the target image, preserving its primary flag and position', () => {
  const items = [item('a', true), item('b')];
  const next = replaceImageAt(items, 1, { mediaAssetId: 'b2', url: 'https://images.example.test/b2.jpg' });
  assert.equal(next[0].mediaAssetId, 'a');
  assert.equal(next[1].mediaAssetId, 'b2');
  assert.equal(next[1].isPrimary, false);
});

// --- moveBefore / moveAfter / reorderByDrag --------------------------------------

test('moveBefore swaps with the previous image; a no-op for the first image', () => {
  const items = [item('a'), item('b'), item('c')];
  assert.deepEqual(moveBefore(items, 1).map((i) => i.mediaAssetId), ['b', 'a', 'c']);
  assert.deepEqual(moveBefore(items, 0).map((i) => i.mediaAssetId), ['a', 'b', 'c']);
});

test('moveAfter swaps with the next image; a no-op for the last image', () => {
  const items = [item('a'), item('b'), item('c')];
  assert.deepEqual(moveAfter(items, 1).map((i) => i.mediaAssetId), ['a', 'c', 'b']);
  assert.deepEqual(moveAfter(items, 2).map((i) => i.mediaAssetId), ['a', 'b', 'c']);
});

test('reorderByDrag moves an image to an arbitrary position, keeping every item exactly once', () => {
  const items = [item('a'), item('b'), item('c'), item('d')];
  const next = reorderByDrag(items, 3, 0);
  assert.deepEqual(next.map((i) => i.mediaAssetId), ['d', 'a', 'b', 'c']);
  assert.equal(next.length, 4);
});

// --- toGalleryPayload -------------------------------------------------------------

test('toGalleryPayload sends only mediaAssetId and isPrimary, in array order', () => {
  const items = [item('a', true), item('b')];
  assert.deepEqual(toGalleryPayload(items), [
    { mediaAssetId: 'a', isPrimary: true },
    { mediaAssetId: 'b', isPrimary: false },
  ]);
});
