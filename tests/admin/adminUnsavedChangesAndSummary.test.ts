import assert from 'node:assert/strict';
import test from 'node:test';

import { anyDirty } from '../../src/admin/unsavedChanges/UnsavedChangesContext.tsx';
import { summarizeOrders, summarizeProducts } from '../../src/admin/summary.ts';
import type { Product } from '../../src/types/cms.ts';
import type { AdminOrder } from '../../src/admin/orderPresentation.ts';

test('anyDirty: clean when no source registered or every source is clean', () => {
  assert.equal(anyDirty({}), false);
  assert.equal(anyDirty({ hero: false, about: false }), false);
});

test('anyDirty: dirty if any single source is dirty -- saving one block never hides the other', () => {
  assert.equal(anyDirty({ hero: true, about: false }), true);
  assert.equal(anyDirty({ hero: false, about: true }), true);
  assert.equal(anyDirty({ hero: true, about: true, products: false }), true);
});

function product(overrides: Partial<Product>): Product {
  return {
    id: 'p1',
    name: 'Producto',
    description: 'desc',
    price: 100,
    imageUrl: '',
    featured: false,
    sortOrder: 0,
    active: true,
    ...overrides,
  };
}

test('summarizeProducts counts only from the real product list, nothing invented', () => {
  const products = [product({ id: '1', active: true }), product({ id: '2', active: true }), product({ id: '3', active: false })];
  assert.deepEqual(summarizeProducts(products), { visibleProducts: 2, hiddenProducts: 1 });
  assert.deepEqual(summarizeProducts([]), { visibleProducts: 0, hiddenProducts: 0 });
});

test('summarizeOrders counts total, review-needing orders via the real review_required/attention signal, and the 5 most recent', () => {
  const orders: AdminOrder[] = [
    { id: '1', created_at: '2026-09-01T00:00:00Z', payment_status: 'approved', order_status: 'confirmed' },
    { id: '2', created_at: '2026-09-05T00:00:00Z', review_required: true, review_reason: 'stock' },
    { id: '3', created_at: '2026-09-03T00:00:00Z', payment_status: 'charged_back', order_status: 'on_hold' },
    { id: '4', created_at: '2026-09-04T00:00:00Z', payment_status: 'unpaid', order_status: 'pending_payment' },
    { id: '5', created_at: '2026-09-02T00:00:00Z', payment_status: 'unpaid', order_status: 'expired' },
    { id: '6', created_at: '2026-08-01T00:00:00Z', payment_status: 'unpaid', order_status: 'expired' },
  ];
  const summary = summarizeOrders(orders);
  assert.equal(summary.orderCount, 6);
  assert.equal(summary.ordersNeedingReview, 2); // id 2 (review_required) and id 3 (charged_back + on_hold)
  assert.equal(summary.recentOrders.length, 5);
  assert.deepEqual(summary.recentOrders.map((order) => order.id), ['2', '4', '3', '5', '1']);
});

test('summarizeOrders on an empty list never fabricates a count', () => {
  assert.deepEqual(summarizeOrders([]), { orderCount: 0, ordersNeedingReview: 0, recentOrders: [] });
});
