import assert from 'node:assert/strict';
import test from 'node:test';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { SalesTrendChart } from '../../src/admin/components/SalesTrendChart.tsx';
import { MetricDelta } from '../../src/admin/components/MetricDelta.tsx';
import { TopProductsCard } from '../../src/admin/components/TopProductsCard.tsx';
import {
  buildDailySalesSeries,
  comparePeriodSales,
  summarizePeriodSales,
  summarizeTopProducts,
} from '../../src/admin/dashboardAnalytics.ts';
import type { AdminOrder } from '../../src/admin/orderPresentation.ts';
import { calculateMetricComparison } from '../../src/admin/salesMetrics.ts';

(globalThis as typeof globalThis & { React: typeof React }).React = React;

const NOW = new Date(2026, 8, 30, 18, 0, 0, 0);

function localDate(daysBefore: number, hour = 10) {
  return new Date(2026, 8, 30 - daysBefore, hour, 0, 0, 0).toISOString();
}

function approvedOrder(overrides: Partial<AdminOrder> = {}): AdminOrder {
  return {
    payment_status: 'approved',
    paid_at: localDate(0),
    total_amount: 10_000,
    order_items: [],
    ...overrides,
  };
}

test('seven-day series is complete, ordered and includes days without sales', () => {
  const series = buildDailySalesSeries([approvedOrder({ paid_at: localDate(0), total_amount: 85_000 })], 7, NOW);

  assert.equal(series.length, 7);
  assert.deepEqual(series.map((point) => point.date), [
    '2026-09-24',
    '2026-09-25',
    '2026-09-26',
    '2026-09-27',
    '2026-09-28',
    '2026-09-29',
    '2026-09-30',
  ]);
  assert.deepEqual(series[0], { date: '2026-09-24', revenue: 0, orders: 0 });
  assert.deepEqual(series[6], { date: '2026-09-30', revenue: 85_000, orders: 1 });
});

test('period sales include the initial boundary and ignore orders outside the range', () => {
  const initialBoundary = new Date(2026, 8, 24, 0, 0, 0, 0);
  const beforeBoundary = new Date(initialBoundary.getTime() - 1);
  const summary = summarizePeriodSales([
    approvedOrder({ paid_at: initialBoundary.toISOString(), total_amount: 4_000 }),
    approvedOrder({ paid_at: beforeBoundary.toISOString(), total_amount: 90_000 }),
    approvedOrder({ paid_at: localDate(0), total_amount: '6000' }),
  ], 7, NOW);

  assert.deepEqual(summary, { revenue: 10_000, orders: 2 });
});

test('seven-day comparison uses adjacent non-overlapping windows and assigns the exact boundary once', () => {
  const currentStart = new Date(2026, 8, 24, 0, 0, 0, 0);
  const previousStart = new Date(2026, 8, 17, 0, 0, 0, 0);
  const comparison = comparePeriodSales([
    approvedOrder({ paid_at: previousStart.toISOString(), total_amount: 100 }),
    approvedOrder({ paid_at: new Date(currentStart.getTime() - 1).toISOString(), total_amount: 200 }),
    approvedOrder({ paid_at: currentStart.toISOString(), total_amount: 300 }),
    approvedOrder({ paid_at: NOW.toISOString(), total_amount: 400 }),
    approvedOrder({ paid_at: new Date(previousStart.getTime() - 1).toISOString(), total_amount: 50_000 }),
    approvedOrder({ paid_at: new Date(NOW.getTime() + 1).toISOString(), total_amount: 50_000 }),
  ], 7, NOW);

  assert.equal(comparison.currentRevenue, 700);
  assert.equal(comparison.previousRevenue, 300);
  assert.equal(comparison.currentOrders, 2);
  assert.equal(comparison.previousOrders, 2);
  assert.equal(comparison.revenueComparison.direction, 'up');
  assert.equal(comparison.ordersComparison.direction, 'flat');
});

test('30-day and 90-day comparisons each use an immediately preceding block of equal length', () => {
  for (const days of [30, 90] as const) {
    const currentStart = new Date(2026, 8, 30 - (days - 1), 0, 0, 0, 0);
    const previousStart = new Date(
      currentStart.getFullYear(),
      currentStart.getMonth(),
      currentStart.getDate() - days,
      0,
      0,
      0,
      0,
    );
    const comparison = comparePeriodSales([
      approvedOrder({ paid_at: currentStart.toISOString(), total_amount: 200 }),
      approvedOrder({ paid_at: previousStart.toISOString(), total_amount: 50 }),
      approvedOrder({ paid_at: new Date(currentStart.getTime() - 1).toISOString(), total_amount: 50 }),
      approvedOrder({ paid_at: new Date(previousStart.getTime() - 1).toISOString(), total_amount: 99_000 }),
    ], days, NOW);

    assert.deepEqual(
      [comparison.currentRevenue, comparison.previousRevenue, comparison.currentOrders, comparison.previousOrders],
      [200, 100, 1, 2],
    );
  }
});

test('period comparison applies the shared paid-sale validation to both windows', () => {
  const comparison = comparePeriodSales([
    approvedOrder({ paid_at: localDate(0), total_amount: 100 }),
    approvedOrder({ paid_at: localDate(7), total_amount: 50 }),
    approvedOrder({ payment_status: 'pending', paid_at: localDate(0), total_amount: 9_000 }),
    approvedOrder({ payment_status: 'refunded', paid_at: localDate(7), total_amount: 9_000 }),
    approvedOrder({ paid_at: 'invalid', total_amount: 9_000 }),
  ], 7, NOW);

  assert.equal(comparison.currentRevenue, 100);
  assert.equal(comparison.previousRevenue, 50);
  assert.equal(comparison.revenueComparison.direction, 'up');
});

test('period comparisons handle empty and zero-baseline windows plus positive and negative changes', () => {
  const empty = comparePeriodSales([], 7, NOW);
  assert.deepEqual(empty.revenueComparison, calculateMetricComparison(0, 0));
  assert.deepEqual(empty.ordersComparison, calculateMetricComparison(0, 0));

  const newSales = comparePeriodSales([approvedOrder({ total_amount: 100 })], 7, NOW);
  assert.deepEqual(newSales.revenueComparison, calculateMetricComparison(100, 0));

  const down = comparePeriodSales([
    approvedOrder({ paid_at: localDate(0), total_amount: 50 }),
    approvedOrder({ paid_at: localDate(7), total_amount: 100 }),
  ], 7, NOW);
  assert.equal(down.revenueComparison.direction, 'down');
  assert.equal(down.revenueComparison.percentage, -50);
});

test('only approved orders with valid paid_at and finite totals count as sales', () => {
  const orders: AdminOrder[] = [
    approvedOrder({ total_amount: 12_000 }),
    approvedOrder({ payment_status: 'pending', total_amount: 90_000 }),
    approvedOrder({ payment_status: 'refunded', total_amount: 90_000 }),
    approvedOrder({ payment_status: 'charged_back', total_amount: 90_000 }),
    approvedOrder({ paid_at: 'not-a-date', total_amount: 90_000 }),
    approvedOrder({ paid_at: null, total_amount: 90_000 }),
    approvedOrder({ total_amount: 'not-a-number' }),
    approvedOrder({ paid_at: localDate(31), total_amount: 90_000 }),
    {
      payment_status: 'pending',
      order_status: 'confirmed',
      paid_at: localDate(0),
      created_at: localDate(0),
      total_amount: 90_000,
    },
  ];

  assert.deepEqual(summarizePeriodSales(orders, 30, NOW), { revenue: 12_000, orders: 1 });
});

test('top products aggregate quantity and revenue across valid paid orders', () => {
  const products = summarizeTopProducts([
    approvedOrder({
      total_amount: 50_000,
      order_items: [
        { product_name: 'Pistola masajeadora', quantity: 2, unit_price: 15_000 },
        { product_name: 'Banda elástica', quantity: 3, unit_price: 2_000 },
      ],
    }),
    approvedOrder({
      paid_at: localDate(3),
      total_amount: 40_000,
      order_items: [
        { product_name: 'Pistola masajeadora', quantity: 1, unit_price: '15000' },
        { product_name: 'Rodillo', quantity: 4, unit_price: 3_000 },
      ],
    }),
  ], 30, NOW);

  assert.deepEqual(products, [
    { name: 'Rodillo', quantity: 4, revenue: 12_000 },
    { name: 'Pistola masajeadora', quantity: 3, revenue: 45_000 },
    { name: 'Banda elástica', quantity: 3, revenue: 6_000 },
  ]);
});

test('top product ties use revenue descending and then name ascending', () => {
  const products = summarizeTopProducts([approvedOrder({
    order_items: [
      { product_name: 'Zeta', quantity: 2, unit_price: 100 },
      { product_name: 'Beta', quantity: 2, unit_price: 200 },
      { product_name: 'Alfa', quantity: 2, unit_price: 200 },
    ],
  })], 30, NOW);

  assert.deepEqual(products.map((product) => product.name), ['Alfa', 'Beta', 'Zeta']);
});

test('invalid items and absent order_items are ignored without losing valid products', () => {
  const products = summarizeTopProducts([
    approvedOrder({ order_items: undefined }),
    approvedOrder({
      order_items: [
        null,
        { product_name: '', quantity: 1, unit_price: 100 },
        { product_name: 'Decimal', quantity: 1.5, unit_price: 100 },
        { product_name: 'Zero', quantity: 0, unit_price: 100 },
        { product_name: 'Negative price', quantity: 1, unit_price: -1 },
        { product_name: 'Bad price', quantity: 1, unit_price: 'invalid' },
        { product_name: 'Válido', quantity: 2, unit_price: 500 },
      ],
    }),
    approvedOrder({ payment_status: 'pending', order_items: [{ product_name: 'No vendido', quantity: 99, unit_price: 1 }] }),
  ], 30, NOW);

  assert.deepEqual(products, [{ name: 'Válido', quantity: 2, revenue: 1_000 }]);
});

test('an empty period returns zero totals, a complete zero series and no products', () => {
  assert.deepEqual(summarizePeriodSales([], 90, NOW), { revenue: 0, orders: 0 });
  assert.equal(buildDailySalesSeries([], 90, NOW).length, 90);
  assert.ok(buildDailySalesSeries([], 90, NOW).every((point) => point.revenue === 0 && point.orders === 0));
  assert.deepEqual(summarizeTopProducts([], 90, NOW), []);
});

test('analytics components expose accessible empty states and never render non-finite SVG values', () => {
  const series = buildDailySalesSeries([], 30, NOW);
  const chartMarkup = renderToStaticMarkup(React.createElement(SalesTrendChart, {
    series,
    summary: { revenue: 0, orders: 0 },
    comparison: calculateMetricComparison(0, 0),
    period: 30,
    onPeriodChange: () => undefined,
  }));
  const productsMarkup = renderToStaticMarkup(React.createElement(TopProductsCard, { products: [], period: 30 }));

  assert.match(chartMarkup, /Todavía no hay ventas cobradas en este período/);
  assert.match(chartMarkup, /aria-pressed="true"/);
  assert.match(productsMarkup, /Todavía no hay ventas de productos en este período/);
  assert.doesNotMatch(chartMarkup + productsMarkup, /NaN|Infinity|>undefined</);
});

test('rendered sales SVG has an accessible title and finite geometry', () => {
  const series = buildDailySalesSeries([approvedOrder()], 7, NOW);
  const markup = renderToStaticMarkup(React.createElement(SalesTrendChart, {
    series,
    summary: summarizePeriodSales([approvedOrder()], 7, NOW),
    comparison: calculateMetricComparison(10_000, 5_000),
    period: 7,
    onPeriodChange: () => undefined,
  }));

  assert.match(markup, /<title[^>]*>Evolución diaria de ventas/);
  assert.match(markup, /role="img"/);
  assert.doesNotMatch(markup, /NaN|Infinity|>undefined</);
});

test('metric delta renders factual text for up, down, flat and new branches', () => {
  const renderDelta = (current: number, previous: number, newLabel = 'Nuevas ventas este mes') => renderToStaticMarkup(
    React.createElement(MetricDelta, {
      comparison: calculateMetricComparison(current, previous),
      comparisonLabel: 'mes anterior',
      newLabel,
      flatLabel: 'Igual que el mes anterior',
    }),
  );

  assert.match(renderDelta(120, 100), /20% vs mes anterior/);
  assert.match(renderDelta(80, 100), /20% vs mes anterior/);
  assert.match(renderDelta(100, 100), /Igual que el mes anterior/);
  assert.match(renderDelta(100, 0), /Nuevas ventas este mes/);
  assert.doesNotMatch(
    [renderDelta(120, 100), renderDelta(80, 100), renderDelta(0, 0), renderDelta(100, 0)].join(''),
    /NaN|Infinity|-Infinity|undefined|Excelente|Malo|Buen rendimiento|Mal rendimiento/,
  );
});
