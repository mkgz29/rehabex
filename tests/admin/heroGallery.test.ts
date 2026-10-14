import assert from 'node:assert/strict';
import test from 'node:test';

import {
  MAX_HERO_IMAGES,
  RECOMMENDED_MIN_HERO_IMAGES,
  addHeroImage,
  canAddMoreHeroImages,
  countEnabledHeroImages,
  heroImageToDraftItem,
  moveHeroImageAfter,
  moveHeroImageBefore,
  removeHeroImageAt,
  reorderHeroImagesByDrag,
  replaceHeroImageAt,
  setHeroImageAltAt,
  shouldWarnFewHeroImages,
  toHeroImagesPayload,
  toggleHeroImageEnabledAt,
  type HeroGalleryDraftItem,
} from '../../src/admin/catalog/heroGallery';

function item(n: number, enabled = true): HeroGalleryDraftItem {
  return { mediaAssetId: `asset-${n}`, url: `https://x.test/${n}.jpg`, alt: '', enabled };
}

test('addHeroImage appends a new, enabled-by-default item, and is a no-op at the max', () => {
  const withOne = addHeroImage([], { mediaAssetId: 'a1', url: 'https://x.test/1.jpg' });
  assert.deepEqual(withOne, [{ mediaAssetId: 'a1', url: 'https://x.test/1.jpg', alt: '', enabled: true }]);

  const full = Array.from({ length: MAX_HERO_IMAGES }, (_, i) => item(i));
  assert.equal(canAddMoreHeroImages(full), false);
  assert.equal(addHeroImage(full, { mediaAssetId: 'extra', url: 'https://x.test/extra.jpg' }).length, MAX_HERO_IMAGES);
});

test('removeHeroImageAt removes exactly the targeted item, no special-case "must keep one"', () => {
  const items = [item(1), item(2), item(3)];
  assert.deepEqual(removeHeroImageAt(items, 1), [item(1), item(3)]);
  assert.deepEqual(removeHeroImageAt([], 0), []);
});

test('replaceHeroImageAt swaps the asset/url, keeps alt and enabled', () => {
  const items = [{ ...item(1), alt: 'Foto 1', enabled: false }];
  const replaced = replaceHeroImageAt(items, 0, { mediaAssetId: 'new', url: 'https://x.test/new.jpg' });
  assert.deepEqual(replaced, [{ mediaAssetId: 'new', url: 'https://x.test/new.jpg', alt: 'Foto 1', enabled: false }]);
});

test('setHeroImageAltAt and toggleHeroImageEnabledAt only touch the targeted item', () => {
  const items = [item(1), item(2)];
  assert.equal(setHeroImageAltAt(items, 1, 'Nueva alt')[1].alt, 'Nueva alt');
  assert.equal(setHeroImageAltAt(items, 1, 'Nueva alt')[0].alt, '');
  const toggled = toggleHeroImageEnabledAt(items, 0);
  assert.equal(toggled[0].enabled, false);
  assert.equal(toggled[1].enabled, true);
});

test('moveHeroImageBefore/After swap with the neighbor and no-op at the edges', () => {
  const items = [item(1), item(2), item(3)];
  assert.deepEqual(moveHeroImageBefore(items, 1).map((i) => i.mediaAssetId), ['asset-2', 'asset-1', 'asset-3']);
  assert.deepEqual(moveHeroImageBefore(items, 0), items);
  assert.deepEqual(moveHeroImageAfter(items, 2), items);
});

test('reorderHeroImagesByDrag moves the item to the target position', () => {
  const items = [item(1), item(2), item(3)];
  assert.deepEqual(reorderHeroImagesByDrag(items, 0, 2).map((i) => i.mediaAssetId), ['asset-2', 'asset-3', 'asset-1']);
});

test('countEnabledHeroImages / shouldWarnFewHeroImages: warns below the recommended minimum, never blocks', () => {
  assert.equal(RECOMMENDED_MIN_HERO_IMAGES, 3);
  assert.equal(shouldWarnFewHeroImages([]), true);
  assert.equal(shouldWarnFewHeroImages([item(1), item(2, false)]), true);
  assert.equal(shouldWarnFewHeroImages([item(1), item(2), item(3)]), false);
  assert.equal(countEnabledHeroImages([item(1), item(2, false), item(3)]), 2);
});

test('toHeroImagesPayload round-trips a real asset item or a legacy (mediaAssetId: null) item by URL', () => {
  const withAsset = toHeroImagesPayload([{ mediaAssetId: 'a1', url: 'https://x.test/1.jpg', alt: 'x', enabled: true }]);
  assert.deepEqual(withAsset, [{ mediaAssetId: 'a1', alt: 'x', enabled: true }]);

  const legacy = toHeroImagesPayload([{ mediaAssetId: null, url: 'https://x.test/legacy.jpg', alt: '', enabled: false }]);
  assert.deepEqual(legacy, [{ legacyUrl: 'https://x.test/legacy.jpg', alt: '', enabled: false }]);
});

test('heroImageToDraftItem maps the server HeroImage shape into the draft shape 1:1', () => {
  assert.deepEqual(heroImageToDraftItem({ mediaAssetId: 'a1', url: 'https://x.test/1.jpg', alt: 'Foto', enabled: true, displayOrder: 0 }), {
    mediaAssetId: 'a1',
    url: 'https://x.test/1.jpg',
    alt: 'Foto',
    enabled: true,
  });
});
