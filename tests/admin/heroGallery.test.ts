import assert from 'node:assert/strict';
import test from 'node:test';

import { DEFAULT_FRAMING, type ImageFraming } from '../../src/lib/imageFraming';
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
  setHeroImageFramingAt,
  shouldWarnFewHeroImages,
  toHeroImagesPayload,
  toggleHeroImageEnabledAt,
  type HeroGalleryDraftItem,
} from '../../src/admin/catalog/heroGallery';

function item(n: number, enabled = true, framing: ImageFraming = { ...DEFAULT_FRAMING }): HeroGalleryDraftItem {
  return { mediaAssetId: `asset-${n}`, url: `https://x.test/${n}.jpg`, alt: '', enabled, framing };
}

test('addHeroImage appends a new, enabled-by-default item with DEFAULT_FRAMING, and is a no-op at the max', () => {
  const withOne = addHeroImage([], { mediaAssetId: 'a1', url: 'https://x.test/1.jpg' });
  assert.deepEqual(withOne, [{ mediaAssetId: 'a1', url: 'https://x.test/1.jpg', alt: '', enabled: true, framing: DEFAULT_FRAMING }]);

  const full = Array.from({ length: MAX_HERO_IMAGES }, (_, i) => item(i));
  assert.equal(canAddMoreHeroImages(full), false);
  assert.equal(addHeroImage(full, { mediaAssetId: 'extra', url: 'https://x.test/extra.jpg' }).length, MAX_HERO_IMAGES);
});

test('removeHeroImageAt removes exactly the targeted item, no special-case "must keep one"', () => {
  const items = [item(1), item(2), item(3)];
  assert.deepEqual(removeHeroImageAt(items, 1), [item(1), item(3)]);
  assert.deepEqual(removeHeroImageAt([], 0), []);
});

test('replaceHeroImageAt swaps the asset/url, keeps alt and enabled, but resets framing to DEFAULT_FRAMING', () => {
  const items = [{ ...item(1), alt: 'Foto 1', enabled: false, framing: { mode: 'contain' as const, focalX: 0.1, focalY: 0.9, zoom: 2 } }];
  const replaced = replaceHeroImageAt(items, 0, { mediaAssetId: 'new', url: 'https://x.test/new.jpg' });
  assert.deepEqual(replaced, [{ mediaAssetId: 'new', url: 'https://x.test/new.jpg', alt: 'Foto 1', enabled: false, framing: DEFAULT_FRAMING }]);
});

test('setHeroImageAltAt and toggleHeroImageEnabledAt only touch the targeted item', () => {
  const items = [item(1), item(2)];
  assert.equal(setHeroImageAltAt(items, 1, 'Nueva alt')[1].alt, 'Nueva alt');
  assert.equal(setHeroImageAltAt(items, 1, 'Nueva alt')[0].alt, '');
  const toggled = toggleHeroImageEnabledAt(items, 0);
  assert.equal(toggled[0].enabled, false);
  assert.equal(toggled[1].enabled, true);
});

test('disabling then re-enabling a slide preserves its exact framing -- toggling enabled never touches framing at all', () => {
  const customFraming: ImageFraming = { mode: 'contain', focalX: 0.33, focalY: 0.67, zoom: 2.1 };
  const framed = setHeroImageFramingAt([item(1)], 0, customFraming);
  const disabled = toggleHeroImageEnabledAt(framed, 0);
  assert.equal(disabled[0].enabled, false);
  assert.deepEqual(disabled[0].framing, customFraming);
  const reEnabled = toggleHeroImageEnabledAt(disabled, 0);
  assert.equal(reEnabled[0].enabled, true);
  assert.deepEqual(reEnabled[0].framing, customFraming);
});

test('setHeroImageFramingAt only touches the targeted item, leaving every other slide (and its framing) untouched', () => {
  const items = [item(1), item(2)];
  const newFraming: ImageFraming = { mode: 'contain', focalX: 0.3, focalY: 0.7, zoom: 2.5 };
  const result = setHeroImageFramingAt(items, 1, newFraming);
  assert.deepEqual(result[1].framing, newFraming);
  assert.deepEqual(result[0].framing, DEFAULT_FRAMING);
});

test('two slides can hold independently different framing at the same time', () => {
  const items = setHeroImageFramingAt(
    setHeroImageFramingAt([item(1), item(2)], 0, { mode: 'fill', focalX: 0, focalY: 0, zoom: 1.5 }),
    1,
    { mode: 'contain', focalX: 1, focalY: 1, zoom: 3 },
  );
  assert.notDeepEqual(items[0].framing, items[1].framing);
  assert.equal(items[0].framing.zoom, 1.5);
  assert.equal(items[1].framing.zoom, 3);
});

test('moveHeroImageBefore/After swap with the neighbor, carrying each item\'s own framing along, and no-op at the edges', () => {
  const items = [item(1), setHeroImageFramingAt([item(2)], 0, { mode: 'contain', focalX: 0.2, focalY: 0.2, zoom: 2 })[0], item(3)];
  const moved = moveHeroImageBefore(items, 1);
  assert.equal(moved[0].mediaAssetId, 'asset-2');
  assert.deepEqual(moved[0].framing, { mode: 'contain', focalX: 0.2, focalY: 0.2, zoom: 2 });
  assert.deepEqual(moveHeroImageBefore(items, 0), items);
  assert.deepEqual(moveHeroImageAfter(items, 2), items);
});

test('reorderHeroImagesByDrag moves the item (and its framing) to the target position', () => {
  const customFramed = setHeroImageFramingAt([item(1)], 0, { mode: 'contain', focalX: 0.9, focalY: 0.1, zoom: 1.8 })[0];
  const items = [customFramed, item(2), item(3)];
  const reordered = reorderHeroImagesByDrag(items, 0, 2);
  assert.deepEqual(reordered.map((i) => i.mediaAssetId), ['asset-2', 'asset-3', 'asset-1']);
  assert.deepEqual(reordered[2].framing, { mode: 'contain', focalX: 0.9, focalY: 0.1, zoom: 1.8 });
});

test('countEnabledHeroImages / shouldWarnFewHeroImages: warns below the recommended minimum, never blocks', () => {
  assert.equal(RECOMMENDED_MIN_HERO_IMAGES, 3);
  assert.equal(shouldWarnFewHeroImages([]), true);
  assert.equal(shouldWarnFewHeroImages([item(1), item(2, false)]), true);
  assert.equal(shouldWarnFewHeroImages([item(1), item(2), item(3)]), false);
  assert.equal(countEnabledHeroImages([item(1), item(2, false), item(3)]), 2);
});

test('toHeroImagesPayload round-trips a real asset item or a legacy (mediaAssetId: null) item by URL, including framing', () => {
  const customFraming: ImageFraming = { mode: 'contain', focalX: 0.25, focalY: 0.75, zoom: 2 };
  const withAsset = toHeroImagesPayload([{ mediaAssetId: 'a1', url: 'https://x.test/1.jpg', alt: 'x', enabled: true, framing: customFraming }]);
  assert.deepEqual(withAsset, [{ mediaAssetId: 'a1', alt: 'x', enabled: true, framing: customFraming }]);

  const legacy = toHeroImagesPayload([{ mediaAssetId: null, url: 'https://x.test/legacy.jpg', alt: '', enabled: false, framing: DEFAULT_FRAMING }]);
  assert.deepEqual(legacy, [{ legacyUrl: 'https://x.test/legacy.jpg', alt: '', enabled: false, framing: DEFAULT_FRAMING }]);
});

test('heroImageToDraftItem maps the server HeroImage shape into the draft shape 1:1, falling back to DEFAULT_FRAMING when framing is absent', () => {
  assert.deepEqual(heroImageToDraftItem({ mediaAssetId: 'a1', url: 'https://x.test/1.jpg', alt: 'Foto', enabled: true, displayOrder: 0, framing: { mode: 'contain', focalX: 0.4, focalY: 0.6, zoom: 1.3 } }), {
    mediaAssetId: 'a1',
    url: 'https://x.test/1.jpg',
    alt: 'Foto',
    enabled: true,
    framing: { mode: 'contain', focalX: 0.4, focalY: 0.6, zoom: 1.3 },
  });

  assert.deepEqual(heroImageToDraftItem({ mediaAssetId: 'a1', url: 'https://x.test/1.jpg', alt: '', enabled: true, displayOrder: 0 }), {
    mediaAssetId: 'a1',
    url: 'https://x.test/1.jpg',
    alt: '',
    enabled: true,
    framing: DEFAULT_FRAMING,
  });
});
