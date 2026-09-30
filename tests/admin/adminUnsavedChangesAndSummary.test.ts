import assert from 'node:assert/strict';
import test from 'node:test';

import { anyDirty } from '../../src/admin/unsavedChanges/UnsavedChangesContext.tsx';
import {
  LOW_STOCK_THRESHOLD,
  summarizeBusinessDashboard,
  summarizeOrders,
  summarizeProducts,
} from '../../src/admin/summary.ts';
import type { Product } from '../../src/types/cms.ts';
import { attentionLevel, type AdminOrder } from '../../src/admin/orderPresentation.ts';
import { calculateMetricComparison } from '../../src/admin/salesMetrics.ts';

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

const SEPTEMBER_NOW = new Date('2026-09-15T12:00:00Z');

test('business dashboard sums only approved payments paid in the current month', () => {
  const orders: AdminOrder[] = [
    { id: 'approved-1', payment_status: 'approved', order_status: 'confirmed', paid_at: '2026-09-02T10:00:00Z', total_amount: 10_000 },
    { id: 'approved-2', payment_status: 'approved', order_status: 'completed', paid_at: '2026-09-12T10:00:00Z', total_amount: '20000' },
    { id: 'pending', payment_status: 'pending', paid_at: '2026-09-03T10:00:00Z', total_amount: 99_000 },
    { id: 'unpaid', payment_status: 'unpaid', paid_at: '2026-09-04T10:00:00Z', total_amount: 99_000 },
    { id: 'rejected', payment_status: 'rejected', paid_at: '2026-09-04T11:00:00Z', total_amount: 99_000 },
    { id: 'cancelled', payment_status: 'cancelled', paid_at: '2026-09-04T12:00:00Z', total_amount: 99_000 },
    { id: 'refunded', payment_status: 'refunded', paid_at: '2026-09-05T10:00:00Z', total_amount: 99_000 },
    { id: 'charged-back', payment_status: 'charged_back', paid_at: '2026-09-06T10:00:00Z', total_amount: 99_000 },
    { id: 'other-month', payment_status: 'approved', paid_at: '2026-08-31T10:00:00Z', total_amount: 99_000 },
    { id: 'no-paid-date', payment_status: 'approved', paid_at: null, total_amount: 99_000 },
    { id: 'invalid-paid-date', payment_status: 'approved', paid_at: 'not-a-date', total_amount: 99_000 },
  ];

  const summary = summarizeBusinessDashboard(orders, [], SEPTEMBER_NOW);
  assert.equal(summary.monthlyPaidSales, 30_000);
  assert.equal(summary.monthlyPaidOrders, 2);
  assert.equal(summary.averageTicket, 15_000);
  assert.equal(summary.monthlyComparison.sales.previous, 99_000);
  assert.equal(summary.monthlyComparison.orders.previous, 1);
  assert.equal(summary.monthlyComparison.averageTicket.previous, 99_000);
});

test('monthly comparison uses current month through now versus the complete previous calendar month', () => {
  const orders: AdminOrder[] = [
    { payment_status: 'approved', paid_at: '2026-09-02T10:00:00Z', total_amount: 10_000 },
    { payment_status: 'approved', paid_at: '2026-09-12T10:00:00Z', total_amount: 20_000 },
    { payment_status: 'approved', paid_at: '2026-09-20T10:00:00Z', total_amount: 500_000 },
    { payment_status: 'approved', paid_at: '2026-08-02T10:00:00Z', total_amount: 10_000 },
    { payment_status: 'approved', paid_at: '2026-08-12T10:00:00Z', total_amount: 10_000 },
    { payment_status: 'approved', paid_at: '2026-08-22T10:00:00Z', total_amount: 10_000 },
    { payment_status: 'approved', paid_at: '2026-08-31T23:00:00Z', total_amount: 10_000 },
  ];
  const summary = summarizeBusinessDashboard(orders, [], SEPTEMBER_NOW);

  assert.equal(summary.monthlyPaidSales, 30_000);
  assert.equal(summary.monthlyPaidOrders, 2);
  assert.equal(summary.averageTicket, 15_000);
  assert.deepEqual(summary.monthlyComparison.sales, {
    current: 30_000,
    previous: 40_000,
    percentage: -25,
    direction: 'down',
  });
  assert.deepEqual(summary.monthlyComparison.orders, {
    current: 2,
    previous: 4,
    percentage: -50,
    direction: 'down',
  });
  assert.deepEqual(summary.monthlyComparison.averageTicket, {
    current: 15_000,
    previous: 10_000,
    percentage: 50,
    direction: 'up',
  });
});

test('metric comparison handles increases, decreases, equality and zero baselines without non-finite values', () => {
  assert.deepEqual(calculateMetricComparison(120, 100), {
    current: 120,
    previous: 100,
    percentage: 20,
    direction: 'up',
  });
  assert.deepEqual(calculateMetricComparison(80, 100), {
    current: 80,
    previous: 100,
    percentage: -20,
    direction: 'down',
  });
  assert.deepEqual(calculateMetricComparison(100, 100), {
    current: 100,
    previous: 100,
    percentage: 0,
    direction: 'flat',
  });
  assert.deepEqual(calculateMetricComparison(100, 0), {
    current: 100,
    previous: 0,
    percentage: null,
    direction: 'new',
  });
  assert.deepEqual(calculateMetricComparison(0, 0), {
    current: 0,
    previous: 0,
    percentage: 0,
    direction: 'flat',
  });
  const nonFinite = calculateMetricComparison(Number.POSITIVE_INFINITY, Number.NaN);
  assert.deepEqual(nonFinite, { current: 0, previous: 0, percentage: 0, direction: 'flat' });
  assert.ok(Object.values(nonFinite).every((value) => value === null || typeof value === 'string' || Number.isFinite(value)));
});

test('monthly windows cross December to January using local calendar boundaries', () => {
  const now = new Date(2027, 0, 10, 18, 0, 0, 0);
  const summary = summarizeBusinessDashboard([
    { payment_status: 'approved', paid_at: new Date(2027, 0, 1, 0, 0, 0, 0).toISOString(), total_amount: 20_000 },
    { payment_status: 'approved', paid_at: new Date(2026, 11, 1, 0, 0, 0, 0).toISOString(), total_amount: 10_000 },
    { payment_status: 'approved', paid_at: new Date(2026, 11, 31, 23, 59, 59, 999).toISOString(), total_amount: 5_000 },
    { payment_status: 'approved', paid_at: new Date(2026, 10, 30, 23, 59, 59, 999).toISOString(), total_amount: 99_000 },
  ], [], now);

  assert.equal(summary.monthlyComparison.sales.current, 20_000);
  assert.equal(summary.monthlyComparison.sales.previous, 15_000);
});

test('the previous calendar month includes all of February, including leap day', () => {
  const now = new Date(2028, 2, 10, 18, 0, 0, 0);
  const summary = summarizeBusinessDashboard([
    { payment_status: 'approved', paid_at: new Date(2028, 2, 2, 10).toISOString(), total_amount: 20_000 },
    { payment_status: 'approved', paid_at: new Date(2028, 1, 1, 0).toISOString(), total_amount: 10_000 },
    { payment_status: 'approved', paid_at: new Date(2028, 1, 29, 23, 59, 59, 999).toISOString(), total_amount: 15_000 },
  ], [], now);

  assert.equal(summary.monthlyComparison.sales.current, 20_000);
  assert.equal(summary.monthlyComparison.sales.previous, 25_000);
});

test('monthly comparison excludes invalid, out-of-range, refunded and charged-back payments', () => {
  const summary = summarizeBusinessDashboard([
    { payment_status: 'approved', paid_at: 'invalid', total_amount: 90_000 },
    { payment_status: 'approved', paid_at: '2026-07-10T10:00:00Z', total_amount: 90_000 },
    { payment_status: 'approved', paid_at: '2026-09-02T10:00:00Z', total_amount: 'invalid' },
    { payment_status: 'refunded', paid_at: '2026-09-02T10:00:00Z', total_amount: 90_000 },
    { payment_status: 'charged_back', paid_at: '2026-08-02T10:00:00Z', total_amount: 90_000 },
  ], [], SEPTEMBER_NOW);

  assert.deepEqual(summary.monthlyComparison.sales, calculateMetricComparison(0, 0));
  assert.deepEqual(summary.monthlyComparison.orders, calculateMetricComparison(0, 0));
});

test('business dashboard returns a zero average ticket when there are no paid sales', () => {
  const summary = summarizeBusinessDashboard(
    [{ payment_status: 'pending', paid_at: '2026-09-02T10:00:00Z', total_amount: 10_000 }],
    [],
    SEPTEMBER_NOW,
  );
  assert.equal(summary.monthlyPaidSales, 0);
  assert.equal(summary.monthlyPaidOrders, 0);
  assert.equal(summary.averageTicket, 0);
});

test('business dashboard order states are exclusive and attentionLevel remains the attention source', () => {
  const orders: AdminOrder[] = [
    { id: 'confirmed', payment_status: 'approved', order_status: 'confirmed' },
    { id: 'completed', payment_status: 'approved', order_status: 'completed' },
    { id: 'pending', payment_status: 'pending', order_status: 'pending_payment' },
    { id: 'unpaid', payment_status: 'unpaid', order_status: 'draft' },
    { id: 'chargeback', payment_status: 'charged_back', order_status: 'on_hold' },
    { id: 'approved-review', payment_status: 'approved', order_status: 'pending_payment' },
    { id: 'refund-review', payment_status: 'refunded', order_status: 'refunded', refund_required: true },
    { id: 'rejected', payment_status: 'rejected', order_status: 'failed' },
    { id: 'cancelled', payment_status: 'cancelled', order_status: 'cancelled' },
    { id: 'refunded', payment_status: 'refunded', order_status: 'refunded' },
    { id: 'expired', payment_status: 'unpaid', order_status: 'expired' },
  ];

  const summary = summarizeBusinessDashboard(orders, [], SEPTEMBER_NOW);
  const attentionCount = orders.filter((order) => attentionLevel(order) === 'attention').length;
  assert.equal(summary.ordersNeedingAttention, attentionCount);
  assert.deepEqual(summary.orderStatus, {
    confirmed: 2,
    waitingForPayment: 2,
    requiringReview: 3,
    finalizedWithoutSale: 4,
  });
  assert.equal(Object.values(summary.orderStatus).reduce((total, count) => total + count, 0), orders.length);
});

test('business dashboard counts and orders only active products with real low stock', () => {
  const products = [
    product({ id: 'undefined', name: 'Sin dato', stockOnHand: undefined }),
    product({ id: 'zero', name: 'Cero', stockOnHand: 0 }),
    product({ id: 'two', name: 'Dos', stockOnHand: 2 }),
    product({ id: 'five', name: 'Cinco', stockOnHand: LOW_STOCK_THRESHOLD }),
    product({ id: 'six', name: 'Seis', stockOnHand: 6 }),
    product({ id: 'negative', name: 'Negativo', stockOnHand: -1 }),
    product({ id: 'hidden', name: 'Oculto', active: false, stockOnHand: 1 }),
  ];

  const summary = summarizeBusinessDashboard([], products, SEPTEMBER_NOW);
  assert.equal(summary.catalog.activeProducts, 6);
  assert.equal(summary.catalog.hiddenProducts, 1);
  assert.equal(summary.catalog.lowStockProducts, 3);
  assert.deepEqual(summary.catalog.lowestStockProducts.map((entry) => entry.id), ['zero', 'two', 'five']);
  assert.equal(summary.catalog.lowestStockProducts.some((entry) => entry.id === 'undefined'), false);
});

test('business dashboard on empty inputs never invents metrics', () => {
  assert.deepEqual(summarizeBusinessDashboard([], [], SEPTEMBER_NOW), {
    monthlyPaidSales: 0,
    monthlyPaidOrders: 0,
    averageTicket: 0,
    monthlyComparison: {
      sales: { current: 0, previous: 0, percentage: 0, direction: 'flat' },
      orders: { current: 0, previous: 0, percentage: 0, direction: 'flat' },
      averageTicket: { current: 0, previous: 0, percentage: 0, direction: 'flat' },
    },
    ordersNeedingAttention: 0,
    orderStatus: {
      confirmed: 0,
      waitingForPayment: 0,
      requiringReview: 0,
      finalizedWithoutSale: 0,
    },
    catalog: {
      activeProducts: 0,
      hiddenProducts: 0,
      lowStockProducts: 0,
      lowestStockProducts: [],
    },
    recentOrders: [],
  });
});
