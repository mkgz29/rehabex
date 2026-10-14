import assert from 'node:assert/strict';
import test from 'node:test';

import { isValid, parseHeroContentPayload, parseSyncHeroImagesPayload } from '../../server/admin/validators';

const ASSET_ID_1 = 'a0000000-0000-4000-8000-000000000001';
const ASSET_ID_2 = 'a0000000-0000-4000-8000-000000000002';

// --- eyebrow on the existing hero content validator --------------------------

const VALID_HERO = {
  title: 'Titulo',
  subtitle: 'Subtitulo',
  image_url: 'https://images.example.test/hero.jpg',
  primary_cta_text: 'Ver mas',
  primary_cta_link: '/tienda',
};

test('parseHeroContentPayload: eyebrow is optional (absent -> empty string, not rejected)', () => {
  const result = parseHeroContentPayload({ value: VALID_HERO, expectedUpdatedAt: null });
  assert.equal(isValid(result), true);
  if (isValid(result)) assert.equal(result.value.content.eyebrow, '');
});

test('parseHeroContentPayload: eyebrow accepts accents/separators, trims, and is bounded', () => {
  const result = parseHeroContentPayload({ value: { ...VALID_HERO, eyebrow: '  Rehabilitación · Movilidad · Bienestar  ' }, expectedUpdatedAt: null });
  assert.equal(isValid(result), true);
  if (isValid(result)) assert.equal(result.value.content.eyebrow, 'Rehabilitación · Movilidad · Bienestar');

  const tooLong = parseHeroContentPayload({ value: { ...VALID_HERO, eyebrow: 'x'.repeat(121) }, expectedUpdatedAt: null });
  assert.equal(isValid(tooLong), false);
});

test('parseHeroContentPayload: eyebrow rejects HTML-looking text, same rule as title/subtitle', () => {
  const result = parseHeroContentPayload({ value: { ...VALID_HERO, eyebrow: '<script>alert(1)</script>' }, expectedUpdatedAt: null });
  assert.equal(isValid(result), false);
});

// --- parseSyncHeroImagesPayload -----------------------------------------------

test('parseSyncHeroImagesPayload accepts a well-formed set of asset-backed images', () => {
  const result = parseSyncHeroImagesPayload({
    images: [
      { mediaAssetId: ASSET_ID_1, alt: 'Primera', enabled: true },
      { mediaAssetId: ASSET_ID_2, alt: '', enabled: false },
    ],
  });
  assert.equal(isValid(result), true);
  if (isValid(result)) assert.equal(result.value.images.length, 2);
});

test('parseSyncHeroImagesPayload accepts an empty array (0 images is allowed)', () => {
  assert.equal(isValid(parseSyncHeroImagesPayload({ images: [] })), true);
});

test('parseSyncHeroImagesPayload accepts a legacy (legacyUrl) item, never both mediaAssetId and legacyUrl', () => {
  const legacy = parseSyncHeroImagesPayload({ images: [{ legacyUrl: 'https://images.example.test/legacy.jpg', alt: '', enabled: true }] });
  assert.equal(isValid(legacy), true);

  const both = parseSyncHeroImagesPayload({ images: [{ mediaAssetId: ASSET_ID_1, legacyUrl: 'https://images.example.test/x.jpg', alt: '', enabled: true }] });
  assert.equal(isValid(both), false);

  const neither = parseSyncHeroImagesPayload({ images: [{ alt: '', enabled: true }] });
  assert.equal(isValid(neither), false);
});

test('parseSyncHeroImagesPayload rejects more than 8 images', () => {
  const tooMany = Array.from({ length: 9 }, (_, i) => ({ legacyUrl: `https://images.example.test/${i}.jpg`, alt: '', enabled: true }));
  assert.equal(isValid(parseSyncHeroImagesPayload({ images: tooMany })), false);
});

test('parseSyncHeroImagesPayload rejects duplicate mediaAssetId within the same payload', () => {
  const dup = parseSyncHeroImagesPayload({ images: [{ mediaAssetId: ASSET_ID_1, alt: '', enabled: true }, { mediaAssetId: ASSET_ID_1, alt: '', enabled: false }] });
  assert.equal(isValid(dup), false);
});

test('parseSyncHeroImagesPayload rejects a non-boolean enabled, an unknown field, or a non-https legacyUrl', () => {
  assert.equal(isValid(parseSyncHeroImagesPayload({ images: [{ mediaAssetId: ASSET_ID_1, alt: '', enabled: 'yes' }] })), false);
  assert.equal(isValid(parseSyncHeroImagesPayload({ images: [{ mediaAssetId: ASSET_ID_1, alt: '', enabled: true, extra: 1 }] })), false);
  assert.equal(isValid(parseSyncHeroImagesPayload({ images: [{ legacyUrl: 'http://images.example.test/x.jpg', alt: '', enabled: true }] })), false);
});

test('parseSyncHeroImagesPayload rejects a non-array images field or an unknown top-level key', () => {
  assert.equal(isValid(parseSyncHeroImagesPayload({ images: 'not-an-array' })), false);
  assert.equal(isValid(parseSyncHeroImagesPayload({ images: [], extra: 1 })), false);
});
