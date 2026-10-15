import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const ADMIN_HERO_SOURCE = readFileSync(join(process.cwd(), 'src/admin/pages/AdminHeroPage.tsx'), 'utf8');
const CAROUSEL_FIELD_SOURCE = readFileSync(join(process.cwd(), 'src/admin/components/HeroCarouselField.tsx'), 'utf8');

// --- 1/2. the legacy "Imagen de portada" block and its uploader are gone ---

test('1/2: AdminHeroPage no longer renders "Imagen de portada" or any legacy uploader -- it never imports ImageField at all', () => {
  assert.doesNotMatch(ADMIN_HERO_SOURCE, /Imagen de portada/);
  assert.doesNotMatch(ADMIN_HERO_SOURCE, /ImageField/);
  assert.doesNotMatch(ADMIN_HERO_SOURCE, /intent="hero"/);
});

// --- 3. the legacy single-image "Acomodar imagen" editor is gone from AdminHeroPage ---
// (the per-slide "Acomodar imagen" inside the carousel is a *different*,
// intentionally-kept button -- see HeroCarouselField's own check below)

test('3: AdminHeroPage itself no longer wires up a framing editor for a single hero image (onFramingChange, DEFAULT_FRAMING import, pendingImageAssetId are all gone)', () => {
  assert.doesNotMatch(ADMIN_HERO_SOURCE, /onFramingChange/);
  assert.doesNotMatch(ADMIN_HERO_SOURCE, /DEFAULT_FRAMING/);
  assert.doesNotMatch(ADMIN_HERO_SOURCE, /pendingImageAssetId/);
});

// --- 4. "Carrusel principal" (HeroCarouselField) still renders -----------------

test('4: HeroCarouselField is still mounted, unchanged, as the only visual image management for the Hero', () => {
  assert.match(ADMIN_HERO_SOURCE, /<HeroCarouselField items=\{carouselItems\} onChange=\{setCarouselItems\} \/>/);
});

test("the carousel's own per-slide 'Acomodar imagen' button is untouched by this phase", () => {
  assert.match(CAROUSEL_FIELD_SOURCE, /Acomodar imagen/);
  assert.match(CAROUSEL_FIELD_SOURCE, /ImageFramerField/);
});

// --- 5. the text fields still render, now as the first thing in the form ---

test('5: every Hero text field (eyebrow, title, subtitle, CTA text, CTA link) still renders', () => {
  assert.match(ADMIN_HERO_SOURCE, /label="Texto superior"/);
  assert.match(ADMIN_HERO_SOURCE, /label="Título principal"/);
  assert.match(ADMIN_HERO_SOURCE, /label="Descripción"/);
  assert.match(ADMIN_HERO_SOURCE, /label="Texto del botón"/);
  assert.match(ADMIN_HERO_SOURCE, /label="A dónde lleva el botón"/);
});

test('the text fields come before the carousel in the form, and the form no longer opens with a 2-column image+text grid', () => {
  const textFieldsIndex = ADMIN_HERO_SOURCE.indexOf('label="Texto superior"');
  const carouselIndex = ADMIN_HERO_SOURCE.indexOf('<HeroCarouselField');
  assert.ok(textFieldsIndex > -1 && carouselIndex > -1 && textFieldsIndex < carouselIndex);
  assert.doesNotMatch(ADMIN_HERO_SOURCE, /xl:grid-cols-2/);
});

// --- 6/7/8. saving still works, and never touches the legacy fields --------

test('6/7/8: AdminHeroPage never writes to heroContent.image_url or heroContent.image_framing anywhere -- whatever was loaded from the server is what gets saved back, unchanged', () => {
  assert.doesNotMatch(ADMIN_HERO_SOURCE, /updateHero\('image_url'/);
  assert.doesNotMatch(ADMIN_HERO_SOURCE, /updateHero\("image_url"/);
  assert.doesNotMatch(ADMIN_HERO_SOURCE, /image_framing:/);
  // saveHeroContent is still called with the full heroContent object (whose
  // image_url/image_framing came straight from the load, never mutated) --
  // toHeroContentApiPayload (unchanged, see adminApi.ts) forwards both
  // verbatim. No third (imageAssetId) argument is passed anymore, since
  // there is no uploader left to produce one.
  assert.match(ADMIN_HERO_SOURCE, /saved = await saveHeroContent\(heroContent, expectedUpdatedAt\);/);
});

// --- cleanliness: no dead state left over from the removed uploader --------

test('no leftover dead state from the removed uploader (isLoading/pendingImageAssetId are both gone, not just unused)', () => {
  assert.doesNotMatch(ADMIN_HERO_SOURCE, /isLoading/);
  assert.doesNotMatch(ADMIN_HERO_SOURCE, /pendingImageAssetId/);
});
