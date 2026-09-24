import assert from 'node:assert/strict';
import test from 'node:test';

import {
  isReservedCategory,
  isValid,
  parseAboutContentPayload,
  parseCreateProductPayload,
  parseHeroContentPayload,
  parseSetActiveProductPayload,
  parseUpdateProductPayload,
} from '../../server/admin/validators';

const PRODUCT_ID = '22222222-2222-4222-8222-222222222222';
const NOW = new Date().toISOString();

const VALID_PRODUCT = {
  name: 'Producto de prueba',
  description: 'Descripcion',
  category: 'Ortopedia',
  price: 100,
  imageUrl: 'https://images.example.test/a.jpg',
  isFeatured: false,
  displayOrder: 0,
};

test('isReservedCategory matches TEST/PRUEBA case- and space-insensitively, not partial words', () => {
  assert.equal(isReservedCategory('TEST'), true);
  assert.equal(isReservedCategory(' test '), true);
  assert.equal(isReservedCategory('PrUeBa'), true);
  assert.equal(isReservedCategory('Contest'), false);
  assert.equal(isReservedCategory('Ortopedia'), false);
});

test('parseCreateProductPayload accepts a well-formed payload', () => {
  const result = parseCreateProductPayload(VALID_PRODUCT);
  assert.ok(isValid(result));
});

test('parseCreateProductPayload rejects unknown fields, including sensitive ones', () => {
  for (const key of ['id', 'stock_on_hand', 'low_stock_threshold', 'reserved_stock', 'currency', 'created_at', 'updated_at', 'created_by', 'updated_by', 'role', 'is_active']) {
    const result = parseCreateProductPayload({ ...VALID_PRODUCT, [key]: 'x' });
    assert.equal(isValid(result), false, `expected ${key} to be rejected`);
  }
});

test('parseCreateProductPayload rejects a reserved category', () => {
  const result = parseCreateProductPayload({ ...VALID_PRODUCT, category: 'TEST' });
  assert.equal(isValid(result), false);
});

test('parseCreateProductPayload rejects invalid prices: NaN, Infinity, zero, negative, string, oversized', () => {
  for (const price of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, 0, -10, '100', '100.00', 1e12]) {
    const result = parseCreateProductPayload({ ...VALID_PRODUCT, price });
    assert.equal(isValid(result), false, `expected price ${String(price)} to be rejected`);
  }
});

test('parseCreateProductPayload rejects an empty or oversized name', () => {
  assert.equal(isValid(parseCreateProductPayload({ ...VALID_PRODUCT, name: '' })), false);
  assert.equal(isValid(parseCreateProductPayload({ ...VALID_PRODUCT, name: '  ' })), false);
  assert.equal(isValid(parseCreateProductPayload({ ...VALID_PRODUCT, name: 'x'.repeat(161) })), false);
});

test('parseCreateProductPayload allows an empty image URL but rejects unsafe protocols', () => {
  assert.equal(isValid(parseCreateProductPayload({ ...VALID_PRODUCT, imageUrl: '' })), true);
  assert.equal(isValid(parseCreateProductPayload({ ...VALID_PRODUCT, imageUrl: null })), true);
  for (const imageUrl of ['javascript:alert(1)', 'data:text/html;base64,abc', 'http://images.example.test/a.jpg', 'ftp://images.example.test/a.jpg']) {
    assert.equal(isValid(parseCreateProductPayload({ ...VALID_PRODUCT, imageUrl })), false, `expected ${imageUrl} to be rejected`);
  }
});

test('parseCreateProductPayload rejects a non-boolean isFeatured and a negative or oversized displayOrder', () => {
  assert.equal(isValid(parseCreateProductPayload({ ...VALID_PRODUCT, isFeatured: 'true' })), false);
  assert.equal(isValid(parseCreateProductPayload({ ...VALID_PRODUCT, displayOrder: -1 })), false);
  assert.equal(isValid(parseCreateProductPayload({ ...VALID_PRODUCT, displayOrder: 1.5 })), false);
  assert.equal(isValid(parseCreateProductPayload({ ...VALID_PRODUCT, displayOrder: 1_000_000 })), false);
});

test('parseUpdateProductPayload requires a UUID id and a version, but allows a reserved category', () => {
  const base = { ...VALID_PRODUCT, id: PRODUCT_ID, expectedUpdatedAt: NOW };
  assert.equal(isValid(parseUpdateProductPayload(base)), true);
  assert.equal(isValid(parseUpdateProductPayload({ ...base, id: 'not-a-uuid' })), false);
  assert.equal(isValid(parseUpdateProductPayload({ ...base, expectedUpdatedAt: undefined })), false);
  assert.equal(isValid(parseUpdateProductPayload({ ...base, expectedUpdatedAt: 'not-a-date' })), false);
  // Editing does not reject a reserved category outright; the RPC enforces the
  // active-product rule with the real stored state.
  assert.equal(isValid(parseUpdateProductPayload({ ...base, category: 'TEST' })), true);
});

test('parseUpdateProductPayload rejects unknown fields', () => {
  const base = { ...VALID_PRODUCT, id: PRODUCT_ID, expectedUpdatedAt: NOW };
  for (const key of ['stock_on_hand', 'role', 'created_by', 'is_active']) {
    assert.equal(isValid(parseUpdateProductPayload({ ...base, [key]: 'x' })), false, `expected ${key} to be rejected`);
  }
});

test('parseSetActiveProductPayload requires id, boolean isActive, and a version', () => {
  const base = { id: PRODUCT_ID, isActive: true, expectedUpdatedAt: NOW };
  assert.equal(isValid(parseSetActiveProductPayload(base)), true);
  assert.equal(isValid(parseSetActiveProductPayload({ ...base, isActive: 'true' })), false);
  assert.equal(isValid(parseSetActiveProductPayload({ ...base, id: 'not-a-uuid' })), false);
  assert.equal(isValid(parseSetActiveProductPayload({ ...base, expectedUpdatedAt: undefined })), false);
  assert.equal(isValid(parseSetActiveProductPayload({ ...base, extra: 1 })), false);
});

const VALID_HERO = {
  title: 'Titulo',
  subtitle: 'Subtitulo',
  image_url: 'https://images.example.test/hero.jpg',
  primary_cta_text: 'Ver mas',
  primary_cta_link: '/tienda',
};

test('parseHeroContentPayload accepts internal, anchor, and https CTA links', () => {
  for (const link of ['/tienda', '#productos', 'https://example.test/promo']) {
    const result = parseHeroContentPayload({ value: { ...VALID_HERO, primary_cta_link: link }, expectedUpdatedAt: null });
    assert.equal(isValid(result), true, `expected ${link} to be accepted`);
  }
});

test('parseHeroContentPayload rejects unsafe CTA links and non-https images', () => {
  for (const link of ['javascript:alert(1)', 'http://example.test/promo', 'data:text/html,x']) {
    assert.equal(isValid(parseHeroContentPayload({ value: { ...VALID_HERO, primary_cta_link: link }, expectedUpdatedAt: null })), false);
  }
  assert.equal(isValid(parseHeroContentPayload({ value: { ...VALID_HERO, image_url: 'http://images.example.test/hero.jpg' }, expectedUpdatedAt: null })), false);
});

test('parseHeroContentPayload rejects an arbitrary settings key or unknown value field', () => {
  const result = parseHeroContentPayload({ key: 'commerce_shipping', value: VALID_HERO, expectedUpdatedAt: null });
  assert.equal(isValid(result), false);
  const withExtra = parseHeroContentPayload({ value: { ...VALID_HERO, extra_field: 'x' }, expectedUpdatedAt: null });
  assert.equal(isValid(withExtra), false);
});

test('parseHeroContentPayload rejects HTML/script-looking text fields', () => {
  const result = parseHeroContentPayload({ value: { ...VALID_HERO, title: '<script>alert(1)</script>' }, expectedUpdatedAt: null });
  assert.equal(isValid(result), false);
});

const VALID_ABOUT = {
  image: 'https://images.example.test/about.jpg',
  title: 'Titulo',
  description: 'Descripcion',
  metrics: [{ id: 'metric-1', value: '+500', label: 'texto explicativo' }],
};

test('parseAboutContentPayload accepts a well-formed payload and enforces a metrics cap', () => {
  assert.equal(isValid(parseAboutContentPayload({ value: VALID_ABOUT, expectedUpdatedAt: null })), true);
  const tooMany = { ...VALID_ABOUT, metrics: Array.from({ length: 7 }, (_, index) => ({ id: `metric-${index}`, value: 'x', label: 'y' })) };
  assert.equal(isValid(parseAboutContentPayload({ value: tooMany, expectedUpdatedAt: null })), false);
});

test('parseAboutContentPayload rejects a malformed metric', () => {
  const badId = { ...VALID_ABOUT, metrics: [{ id: 'has spaces', value: 'x', label: 'y' }] };
  assert.equal(isValid(parseAboutContentPayload({ value: badId, expectedUpdatedAt: null })), false);
  const extraField = { ...VALID_ABOUT, metrics: [{ id: 'metric-1', value: 'x', label: 'y', script: '<b>' }] };
  assert.equal(isValid(parseAboutContentPayload({ value: extraField, expectedUpdatedAt: null })), false);
});

test('parseAboutContentPayload requires a non-empty image and title', () => {
  assert.equal(isValid(parseAboutContentPayload({ value: { ...VALID_ABOUT, image: '' }, expectedUpdatedAt: null })), false);
  assert.equal(isValid(parseAboutContentPayload({ value: { ...VALID_ABOUT, title: '' }, expectedUpdatedAt: null })), false);
});
