import assert from 'node:assert/strict';
import test from 'node:test';

import {
  isValid,
  parseAboutContentPayload,
  parseCatalogSectionContentPayload,
  parseCreateProductPayload,
  parseFeaturedProductsPayload,
  parseFeaturedSectionContentPayload,
  parseHeroContentPayload,
} from '../../server/admin/validators';

const ASSET_ID = 'a0000000-0000-4000-8000-000000000001';
const PRODUCT_ID = '22222222-2222-4222-8222-222222222222';
const PRODUCT_ID_2 = '33333333-3333-4333-8333-333333333333';
const VALID_FRAMING = { mode: 'fill', focalX: 0.5, focalY: 0.5, zoom: 1 };

const VALID_HERO = {
  value: { title: 'Titulo', subtitle: '', image_url: 'https://res.cloudinary.com/demo/a.jpg', primary_cta_text: 'Ir', primary_cta_link: '/tienda' },
  expectedUpdatedAt: null,
  imageAssetId: null,
};

const VALID_ABOUT = {
  value: { image: 'https://res.cloudinary.com/demo/a.jpg', title: 'Nosotros', description: 'desc', metrics: [] },
  expectedUpdatedAt: null,
  imageAssetId: null,
};

// --- Image framing on Hero/About ---------------------------------------------

test('parseHeroContentPayload accepts an absent image_framing (defaults apply downstream)', () => {
  const result = parseHeroContentPayload(VALID_HERO);
  assert.equal(isValid(result), true);
});

test('parseHeroContentPayload accepts a fully valid image_framing', () => {
  const result = parseHeroContentPayload({ ...VALID_HERO, value: { ...VALID_HERO.value, image_framing: VALID_FRAMING } });
  assert.equal(isValid(result), true);
});

test('parseHeroContentPayload rejects a malformed image_framing', () => {
  assert.equal(isValid(parseHeroContentPayload({ ...VALID_HERO, value: { ...VALID_HERO.value, image_framing: { mode: 'stretch', focalX: 0.5, focalY: 0.5, zoom: 1 } } })), false);
  assert.equal(isValid(parseHeroContentPayload({ ...VALID_HERO, value: { ...VALID_HERO.value, image_framing: { mode: 'fill', focalX: 2, focalY: 0.5, zoom: 1 } } })), false);
  assert.equal(isValid(parseHeroContentPayload({ ...VALID_HERO, value: { ...VALID_HERO.value, image_framing: { mode: 'fill', focalX: 0.5, focalY: 0.5, zoom: 10 } } })), false);
});

test('parseAboutContentPayload accepts a fully valid image_framing and an absent one', () => {
  assert.equal(isValid(parseAboutContentPayload(VALID_ABOUT)), true);
  assert.equal(isValid(parseAboutContentPayload({ ...VALID_ABOUT, value: { ...VALID_ABOUT.value, image_framing: VALID_FRAMING } })), true);
});

test('parseAboutContentPayload allows a metric with an empty value and/or label (clearing it is a real, saveable state)', () => {
  const result = parseAboutContentPayload({ ...VALID_ABOUT, value: { ...VALID_ABOUT.value, metrics: [{ id: 'metric-1', value: '', label: '' }] } });
  assert.equal(isValid(result), true);
  if (isValid(result)) assert.deepEqual(result.value.content.metrics, [{ id: 'metric-1', value: '', label: '' }]);
});

// --- Gallery item framing -----------------------------------------------------

test('parseCreateProductPayload accepts a gallery item with a valid framing object', () => {
  const result = parseCreateProductPayload({
    name: 'Producto', description: '', category: 'Ortopedia', price: 100,
    gallery: [{ mediaAssetId: ASSET_ID, isPrimary: true, framing: VALID_FRAMING }],
    isFeatured: false, displayOrder: 0, isActive: false,
  });
  assert.equal(isValid(result), true);
});

test('parseCreateProductPayload rejects a gallery item with an invalid framing object', () => {
  const result = parseCreateProductPayload({
    name: 'Producto', description: '', category: 'Ortopedia', price: 100,
    gallery: [{ mediaAssetId: ASSET_ID, isPrimary: true, framing: { mode: 'fill', focalX: 0.5, focalY: 0.5, zoom: -1 } }],
    isFeatured: false, displayOrder: 0, isActive: false,
  });
  assert.equal(isValid(result), false);
});

// --- Featured/Catalog section copy -------------------------------------------

test('parseFeaturedSectionContentPayload accepts a valid title/subtitle and allows an empty subtitle', () => {
  assert.equal(isValid(parseFeaturedSectionContentPayload({ value: { title: 'Título', subtitle: '' }, expectedUpdatedAt: null })), true);
});

test('parseFeaturedSectionContentPayload rejects an empty title', () => {
  assert.equal(isValid(parseFeaturedSectionContentPayload({ value: { title: '', subtitle: 'x' }, expectedUpdatedAt: null })), false);
});

test('parseFeaturedSectionContentPayload rejects an unknown field', () => {
  assert.equal(isValid(parseFeaturedSectionContentPayload({ value: { title: 'x', subtitle: 'x', eyebrow: 'x' }, expectedUpdatedAt: null })), false);
});

test('parseCatalogSectionContentPayload accepts a valid title/subtitle', () => {
  assert.equal(isValid(parseCatalogSectionContentPayload({ value: { title: 'Título', subtitle: 'Subtítulo' }, expectedUpdatedAt: null })), true);
});

// --- Featured products curation -----------------------------------------------

test('parseFeaturedProductsPayload accepts a valid list of items', () => {
  const result = parseFeaturedProductsPayload({
    items: [
      { id: PRODUCT_ID, isFeatured: true, displayOrder: 0 },
      { id: PRODUCT_ID_2, isFeatured: false, displayOrder: 5 },
    ],
  });
  assert.equal(isValid(result), true);
});

test('parseFeaturedProductsPayload rejects a duplicated product id', () => {
  const result = parseFeaturedProductsPayload({
    items: [
      { id: PRODUCT_ID, isFeatured: true, displayOrder: 0 },
      { id: PRODUCT_ID, isFeatured: false, displayOrder: 1 },
    ],
  });
  assert.equal(isValid(result), false);
});

test('parseFeaturedProductsPayload rejects a malformed id, a non-boolean isFeatured, or a negative order', () => {
  assert.equal(isValid(parseFeaturedProductsPayload({ items: [{ id: 'not-a-uuid', isFeatured: true, displayOrder: 0 }] })), false);
  assert.equal(isValid(parseFeaturedProductsPayload({ items: [{ id: PRODUCT_ID, isFeatured: 'yes', displayOrder: 0 }] })), false);
  assert.equal(isValid(parseFeaturedProductsPayload({ items: [{ id: PRODUCT_ID, isFeatured: true, displayOrder: -1 }] })), false);
});

test('parseFeaturedProductsPayload accepts an empty list (no-op save)', () => {
  const result = parseFeaturedProductsPayload({ items: [] });
  assert.equal(isValid(result), true);
  if (isValid(result)) assert.deepEqual(result.value, []);
});
