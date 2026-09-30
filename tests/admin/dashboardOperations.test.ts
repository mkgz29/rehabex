import assert from 'node:assert/strict';
import test from 'node:test';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';

import { OperationsCenter } from '../../src/admin/components/OperationsCenter.tsx';
import { summarizeDashboardOperations } from '../../src/admin/dashboardOperations.ts';
import type { AdminOrder } from '../../src/admin/orderPresentation.ts';
import type { Product } from '../../src/types/cms.ts';

(globalThis as typeof globalThis & { React: typeof React }).React = React;

function order(id: string, overrides: Partial<AdminOrder> = {}): AdminOrder {
  return {
    id,
    payment_status: 'approved',
    order_status: 'confirmed',
    fulfillment_status: 'not_started',
    ...overrides,
  };
}

function product(id: string, name: string, stockOnHand: number | undefined, active = true): Product {
  return {
    id,
    name,
    description: '',
    price: 1,
    imageUrl: '',
    featured: false,
    sortOrder: 0,
    active,
    stockOnHand,
  };
}

test('operational orders are classified by fulfillment without mixing attention cases', () => {
  const operations = summarizeDashboardOperations([
    order('prepare'),
    order('preparing', { fulfillment_status: 'preparing' }),
    order('ready', { fulfillment_status: 'ready_for_pickup' }),
    order('shipped', { fulfillment_status: 'shipped' }),
    order('pending', { payment_status: 'pending' }),
    order('refunded', { payment_status: 'refunded' }),
    order('attention', { review_required: true }),
    order('legacy-null', { fulfillment_status: null }),
  ], []);

  assert.deepEqual(operations.ordersToPrepare.map((entry) => entry.id), ['prepare']);
  assert.deepEqual(operations.ordersPreparing.map((entry) => entry.id), ['preparing']);
  assert.deepEqual(operations.ordersReadyForPickup.map((entry) => entry.id), ['ready']);
  assert.deepEqual(operations.ordersShipped.map((entry) => entry.id), ['shipped']);
  assert.deepEqual(operations.ordersNeedingAttention.map((entry) => entry.id), ['attention']);
});

test('attentionLevel is the exclusive source of review work and prevents normal preparation', () => {
  const problematic = order('problematic', {
    payment_status: 'approved',
    order_status: 'confirmed',
    fulfillment_status: 'not_started',
    refund_required: true,
  });
  const operations = summarizeDashboardOperations([problematic], []);

  assert.deepEqual(operations.ordersNeedingAttention, [problematic]);
  assert.deepEqual(operations.ordersToPrepare, []);
});

test('stock alerts include only active products with real operational stock and sort by stock then name', () => {
  const operations = summarizeDashboardOperations([], [
    product('critical-b', 'Beta', 1),
    product('critical-a', 'Alfa', 1),
    product('critical-two', 'Gamma', 2),
    product('out-b', 'Zeta', 0),
    product('out-a', 'Delta', 0),
    product('three', 'Stock tres', 3),
    product('undefined', 'Sin dato', undefined),
    product('hidden', 'Oculto', 0, false),
    product('negative', 'Negativo', -1),
    product('invalid', 'Inválido', Number.NaN),
  ]);

  assert.deepEqual(operations.outOfStockProducts.map((entry) => entry.id), ['out-a', 'out-b']);
  assert.deepEqual(operations.criticalStockProducts.map((entry) => entry.id), ['critical-a', 'critical-b', 'critical-two']);
});

test('empty inputs produce valid empty operation lists', () => {
  assert.deepEqual(summarizeDashboardOperations([], []), {
    ordersToPrepare: [],
    ordersPreparing: [],
    ordersReadyForPickup: [],
    ordersShipped: [],
    ordersNeedingAttention: [],
    criticalStockProducts: [],
    outOfStockProducts: [],
  });
});

function renderOperations(operations = summarizeDashboardOperations([], []), ordersAvailable = true) {
  return renderToStaticMarkup(
    React.createElement(
      MemoryRouter,
      null,
      React.createElement(OperationsCenter, { operations, ordersAvailable }),
    ),
  );
}

test('operations center has a compact positive empty state and existing admin routes', () => {
  const markup = renderOperations();

  assert.match(markup, /Todo al día por ahora/);
  assert.match(markup, /href="\/admin\/pedidos"/);
  assert.match(markup, /href="\/admin\/productos"/);
  assert.doesNotMatch(markup, /not_started|preparing|ready_for_pickup|shipped/);
});

test('operations center translates active work and emphasizes order review', () => {
  const operations = summarizeDashboardOperations([
    order('prepare'),
    order('preparing', { fulfillment_status: 'preparing' }),
    order('ready', { fulfillment_status: 'ready_for_pickup' }),
    order('shipped', { fulfillment_status: 'shipped' }),
    order('attention', { review_required: true }),
  ], [product('out', 'Producto agotado', 0)]);
  const markup = renderOperations(operations);

  assert.match(markup, /Pedidos por preparar/);
  assert.match(markup, /Pedidos en preparación/);
  assert.match(markup, /Listos para retiro/);
  assert.match(markup, /Pedidos enviados/);
  assert.match(markup, /Revisar pedidos/);
  assert.match(markup, /Productos sin stock/);
  assert.doesNotMatch(markup, /not_started|ready_for_pickup/);
});

test('operations center reports the full stock count but displays at most five product names', () => {
  const products = Array.from({ length: 6 }, (_, index) => (
    product(`out-${index + 1}`, `Agotado ${index + 1}`, 0)
  ));
  const markup = renderOperations(summarizeDashboardOperations([], products));

  assert.match(markup, /aria-label="6 productos sin stock"/);
  assert.match(markup, /Agotado 5/);
  assert.doesNotMatch(markup, /Agotado 6/);
});
