import assert from 'node:assert/strict';
import test from 'node:test';

import { buildFulfillmentSteps } from '../../src/lib/fulfillmentTimeline';
import { buildOrderTrackingFragment, buildOrderTrackingUrl, parseOrderTrackingFragment } from '../../src/lib/orderTrackingLink';

const ORDER_ID = '159e3369-63a9-4879-b5ce-8f0db6369508';
const TOKEN = 'a'.repeat(43);

// --- orderTrackingLink --------------------------------------------------------

test('buildOrderTrackingFragment joins orderId and token with a dot', () => {
  assert.equal(buildOrderTrackingFragment(ORDER_ID, TOKEN), `${ORDER_ID}.${TOKEN}`);
});

test('buildOrderTrackingUrl builds an absolute /mi-pedido URL with the fragment, never a query string', () => {
  const url = buildOrderTrackingUrl('https://rehabex.com.ar', ORDER_ID, TOKEN);
  assert.equal(url, `https://rehabex.com.ar/mi-pedido#${ORDER_ID}.${TOKEN}`);
  assert.doesNotMatch(url, /\?/);
});

test('buildOrderTrackingUrl strips a trailing slash from the site URL', () => {
  const url = buildOrderTrackingUrl('https://rehabex.com.ar/', ORDER_ID, TOKEN);
  assert.equal(url, `https://rehabex.com.ar/mi-pedido#${ORDER_ID}.${TOKEN}`);
});

test('parseOrderTrackingFragment round-trips a well-formed fragment, with or without the leading #', () => {
  const fragment = buildOrderTrackingFragment(ORDER_ID, TOKEN);
  assert.deepEqual(parseOrderTrackingFragment(fragment), { orderId: ORDER_ID, token: TOKEN });
  assert.deepEqual(parseOrderTrackingFragment(`#${fragment}`), { orderId: ORDER_ID, token: TOKEN });
});

test('parseOrderTrackingFragment rejects a malformed orderId, a malformed token, or garbage', () => {
  assert.equal(parseOrderTrackingFragment(`not-a-uuid.${TOKEN}`), null);
  assert.equal(parseOrderTrackingFragment(`${ORDER_ID}.too-short`), null);
  assert.equal(parseOrderTrackingFragment(''), null);
  assert.equal(parseOrderTrackingFragment('#'), null);
  assert.equal(parseOrderTrackingFragment(ORDER_ID), null); // no separator at all
});

// --- fulfillmentTimeline -------------------------------------------------------

test('buildFulfillmentSteps: pickup sequence is confirmed -> preparing -> ready_for_pickup -> delivered', () => {
  const steps = buildFulfillmentSteps('pickup', 'ready_for_pickup');
  assert.deepEqual(steps.map((s) => s.status), ['not_started', 'preparing', 'ready_for_pickup', 'delivered']);
  assert.deepEqual(steps.map((s) => s.done), [true, true, true, false]);
});

test('buildFulfillmentSteps: delivery sequence is confirmed -> preparing -> shipped -> delivered (never ready_for_pickup)', () => {
  const steps = buildFulfillmentSteps('delivery', 'shipped');
  assert.deepEqual(steps.map((s) => s.status), ['not_started', 'preparing', 'shipped', 'delivered']);
  assert.ok(!steps.some((s) => s.status === 'ready_for_pickup'));
});

test('buildFulfillmentSteps: delivered marks every step done', () => {
  const steps = buildFulfillmentSteps('pickup', 'delivered');
  assert.ok(steps.every((s) => s.done));
});

test('buildFulfillmentSteps: not_started marks only the first step done', () => {
  const steps = buildFulfillmentSteps('delivery', 'not_started');
  assert.deepEqual(steps.map((s) => s.done), [true, false, false, false]);
});

test('buildFulfillmentSteps: cancelled, returned, or null status all return an empty list (caller shows a distinct message instead)', () => {
  assert.deepEqual(buildFulfillmentSteps('pickup', 'cancelled'), []);
  assert.deepEqual(buildFulfillmentSteps('pickup', 'returned'), []);
  assert.deepEqual(buildFulfillmentSteps('pickup', null), []);
});
