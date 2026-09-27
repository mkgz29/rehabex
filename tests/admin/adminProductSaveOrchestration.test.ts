import assert from 'node:assert/strict';
import test from 'node:test';

import { mergeProductIntoList, saveProduct } from '../../src/admin/catalog/productSaveOrchestration.ts';
import type { Product, ProductInput } from '../../src/types/cms.ts';

// The real atomicity guarantee (content + image + visibility as one
// transaction) now lives entirely in admin_create_product_with_media /
// admin_update_product_with_media -- covered against a real local Postgres
// in tests/db/adminProductAtomicity.test.ts. This file only exercises the
// thin client-side wiring: which single RPC gets called, and that the list
// is updated (append vs. replace) without ever calling create twice.

function baseInput(overrides: Partial<ProductInput> = {}): ProductInput {
  return {
    name: 'Rodillera',
    description: '',
    price: 15000,
    imageUrl: '',
    category: 'Ortopedia',
    featured: false,
    sortOrder: 0,
    active: true,
    ...overrides,
  };
}

function productFrom(input: ProductInput, overrides: Partial<Product> = {}): Product {
  return {
    id: input.id ?? '11111111-1111-4111-8111-111111111111',
    name: input.name,
    description: input.description,
    price: input.price,
    imageUrl: input.imageUrl,
    category: input.category,
    featured: input.featured,
    sortOrder: input.sortOrder,
    active: input.active,
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

test('a new product calls createProduct exactly once, never updateProduct', async () => {
  let createCalls = 0;
  const created = productFrom(baseInput({ active: true }));

  const result = await saveProduct(
    baseInput({ active: true }),
    { editingUpdatedAt: null, gallery: [] },
    {
      createProduct: async (input) => {
        createCalls += 1;
        assert.equal(input.active, true, 'the visibility the admin chose must be sent in the same request');
        return created;
      },
      updateProduct: async () => {
        throw new Error('must not be called for a new product');
      },
    },
  );

  assert.equal(createCalls, 1);
  assert.equal(result.active, true);
});

test('an existing product calls updateProduct exactly once, never createProduct, and requires a known version', async () => {
  const updated = productFrom(baseInput({ active: false }), { id: 'p1' });
  let updateCalls = 0;

  const result = await saveProduct(
    baseInput({ id: 'p1', active: false }),
    { editingUpdatedAt: '2026-01-01T00:00:00.000Z', gallery: [] },
    {
      createProduct: async () => {
        throw new Error('must not be called for an existing product');
      },
      updateProduct: async (input) => {
        updateCalls += 1;
        assert.equal(input.expectedUpdatedAt, '2026-01-01T00:00:00.000Z');
        assert.equal(input.active, false);
        return updated;
      },
    },
  );

  assert.equal(updateCalls, 1);
  assert.equal(result.active, false);
});

test('editing without a known version is refused before any request is made', async () => {
  await assert.rejects(
    saveProduct(
      baseInput({ id: 'p1' }),
      { editingUpdatedAt: null, gallery: [] },
      {
        createProduct: async () => {
          throw new Error('must not be called');
        },
        updateProduct: async () => {
          throw new Error('must not be called without a version to check against');
        },
      },
    ),
  );
});

test('a rejected save (thrown error) never touches the list: nothing to merge', async () => {
  await assert.rejects(
    saveProduct(
      baseInput({ active: true }),
      { editingUpdatedAt: null, gallery: [] },
      {
        createProduct: async () => {
          throw new Error('ADM09 conflict');
        },
        updateProduct: async () => {
          throw new Error('must not be called');
        },
      },
    ),
    /ADM09/,
  );
});

test('mergeProductIntoList appends a new product exactly once and updates an existing one in place', () => {
  const existing = [productFrom(baseInput({ name: 'A' }), { id: 'a' }), productFrom(baseInput({ name: 'B' }), { id: 'b' })];

  const appended = mergeProductIntoList(existing, productFrom(baseInput({ name: 'C' }), { id: 'c' }), true);
  assert.equal(appended.length, 3);

  const updatedList = mergeProductIntoList(existing, productFrom(baseInput({ name: 'A2' }), { id: 'a' }), false);
  assert.equal(updatedList.length, 2);
  assert.equal(updatedList.find((p) => p.id === 'a')?.name, 'A2');
  assert.equal(updatedList.find((p) => p.id === 'b')?.name, 'B');
});
