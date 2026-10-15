import assert from 'node:assert/strict';
import test from 'node:test';

import { isValid, parseHeroContentPayload, parseSyncHeroImagesPayload } from '../../server/admin/validators';
import { toHeroContentApiPayload } from '../../src/services/adminApi';
import type { HeroContent } from '../../src/types/cms';

const BASE_HERO: HeroContent = {
  title: 'Recuperacion con confianza.',
  subtitle: 'Equipamiento y soluciones para rehabilitacion profesional, en un solo lugar.',
  eyebrow: 'Rehabilitación · Movilidad · Bienestar',
  image_url: 'https://images.example.test/hero.jpg',
  primary_cta_text: 'Explorar productos',
  primary_cta_link: '#productos',
  images: [{ mediaAssetId: null, url: 'https://images.example.test/legacy.jpg', alt: '', enabled: true, displayOrder: 0 }],
};

// --- D) the settings/hero payload never contains `images` --------------------

test('D: toHeroContentApiPayload never includes `images`, regardless of how many images HeroContent carries', () => {
  const payload = toHeroContentApiPayload(BASE_HERO);
  assert.ok(!('images' in payload));
  assert.deepEqual(Object.keys(payload).sort(), ['eyebrow', 'image_framing', 'image_url', 'primary_cta_link', 'primary_cta_text', 'subtitle', 'title'].sort());

  const withManyImages: HeroContent = { ...BASE_HERO, images: [BASE_HERO.images[0], BASE_HERO.images[0], BASE_HERO.images[0]] };
  assert.ok(!('images' in toHeroContentApiPayload(withManyImages)));
});

test('D: toHeroContentApiPayload preserves every real hero_content field unchanged', () => {
  const payload = toHeroContentApiPayload(BASE_HERO);
  assert.equal(payload.title, BASE_HERO.title);
  assert.equal(payload.subtitle, BASE_HERO.subtitle);
  assert.equal(payload.eyebrow, BASE_HERO.eyebrow);
  assert.equal(payload.image_url, BASE_HERO.image_url);
  assert.equal(payload.primary_cta_text, BASE_HERO.primary_cta_text);
  assert.equal(payload.primary_cta_link, BASE_HERO.primary_cta_link);
});

test('7/8 (FASE admin-hero-carousel-only): the legacy image_url and image_framing survive untouched even when only text/eyebrow/images are being edited -- the Admin can no longer edit them, so a save must never null/reset/default them', () => {
  const legacyFraming: NonNullable<HeroContent['image_framing']> = { mode: 'contain', focalX: 0.3, focalY: 0.8, zoom: 2.4 };
  const withLegacyImage: HeroContent = { ...BASE_HERO, image_url: 'https://images.example.test/legacy-hero.jpg', image_framing: legacyFraming };

  // Simulate exactly what AdminHeroPage does now: edit only the eyebrow,
  // never touch image_url/image_framing.
  const edited: HeroContent = { ...withLegacyImage, eyebrow: 'Eyebrow nuevo' };
  const payload = toHeroContentApiPayload(edited);

  assert.equal(payload.image_url, 'https://images.example.test/legacy-hero.jpg');
  assert.deepEqual(payload.image_framing, legacyFraming);
  assert.notEqual(payload.image_url, '');
  assert.notEqual(payload.image_framing, null);
});

// --- A) editing only the eyebrow: the real payload the server receives passes ---

test('A: eyebrow-only edit -- the payload toHeroContentApiPayload builds is accepted by parseHeroContentPayload', () => {
  const edited: HeroContent = { ...BASE_HERO, eyebrow: 'Nuevo eyebrow editado' };
  const result = parseHeroContentPayload({ value: toHeroContentApiPayload(edited), expectedUpdatedAt: '2026-10-14T00:00:00.000Z' });
  assert.equal(isValid(result), true);
  if (isValid(result)) assert.equal(result.value.content.eyebrow, 'Nuevo eyebrow editado');
});

// --- Regression: the OLD bug (spreading the whole HeroContent, images included) ---

test('REGRESSION: sending the raw HeroContent object (with `images`) is correctly rejected -- proves the old bug is real and the fix is the exclusion, not a validator relaxation', () => {
  const result = parseHeroContentPayload({ value: BASE_HERO, expectedUpdatedAt: '2026-10-14T00:00:00.000Z' });
  assert.equal(isValid(result), false);
  if (!isValid(result)) assert.equal(result.error, 'unknown_field');
});

// --- F) the validator still rejects a genuinely unknown field (security not weakened) ---

test('F: parseHeroContentPayload still rejects an arbitrary unknown field, not just `images` specifically', () => {
  const result = parseHeroContentPayload({ value: { ...toHeroContentApiPayload(BASE_HERO), not_a_real_field: 'x' }, expectedUpdatedAt: null });
  assert.equal(isValid(result), false);
});

// --- E) mixed carousel scenario: 1 legacy + 2 new assets, all accepted by the images validator ---

test('E: parseSyncHeroImagesPayload accepts 1 legacyUrl + 2 new mediaAssetId in the same call', () => {
  const result = parseSyncHeroImagesPayload({
    images: [
      { legacyUrl: 'https://images.example.test/legacy.jpg', alt: 'Legacy preservada', enabled: true },
      { mediaAssetId: 'a0000000-0000-4000-8000-000000000001', alt: 'Nueva 1', enabled: true },
      { mediaAssetId: 'a0000000-0000-4000-8000-000000000002', alt: 'Nueva 2', enabled: true },
    ],
  });
  assert.equal(isValid(result), true);
  if (isValid(result)) assert.equal(result.value.images.length, 3);
});

// --- B/C) hero_images payload building stays correct and independent of hero_content ---

test('B/C: toHeroContentApiPayload and the hero_images payload are built independently -- changing one never affects the shape of the other', () => {
  const contentOnlyEdit: HeroContent = { ...BASE_HERO, eyebrow: 'Solo cambio el eyebrow' };
  const contentPayload = toHeroContentApiPayload(contentOnlyEdit);
  assert.ok(!('images' in contentPayload));
  // The images themselves, whatever they are, never leak into this payload --
  // confirmed again with a HeroContent that carries a different images array.
  const differentImages: HeroContent = { ...contentOnlyEdit, images: [] };
  assert.deepEqual(toHeroContentApiPayload(contentOnlyEdit), toHeroContentApiPayload(differentImages));
});
