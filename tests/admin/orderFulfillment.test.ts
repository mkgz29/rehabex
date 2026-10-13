import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

import { isValid, parseUpdateOrderFulfillmentStatusPayload } from '../../server/admin/validators';
import { nextFulfillmentTransitions, type AdminOrder } from '../../src/admin/orderPresentation';

const ORDER_ID = '22222222-2222-4222-8222-222222222222';

// --- parseUpdateOrderFulfillmentStatusPayload ---------------------------------

test('parseUpdateOrderFulfillmentStatusPayload accepts a well-formed payload, with or without a note', () => {
  const withNote = parseUpdateOrderFulfillmentStatusPayload({ id: ORDER_ID, toStatus: 'preparing', note: 'listo en 2 dias' });
  assert.equal(isValid(withNote), true);
  if (isValid(withNote)) assert.deepEqual(withNote.value, { id: ORDER_ID, toStatus: 'preparing', note: 'listo en 2 dias' });

  const withoutNote = parseUpdateOrderFulfillmentStatusPayload({ id: ORDER_ID, toStatus: 'delivered', note: null });
  assert.equal(isValid(withoutNote), true);
  if (isValid(withoutNote)) assert.equal(withoutNote.value.note, null);
});

test('parseUpdateOrderFulfillmentStatusPayload rejects a non-UUID id', () => {
  assert.equal(isValid(parseUpdateOrderFulfillmentStatusPayload({ id: 'not-a-uuid', toStatus: 'preparing', note: null })), false);
});

test('parseUpdateOrderFulfillmentStatusPayload rejects anything outside the 5 admin-settable statuses (not_started is never a target, only a starting point)', () => {
  for (const toStatus of ['not_started', 'returned', 'approved', 'confirmed', 'nonsense']) {
    assert.equal(isValid(parseUpdateOrderFulfillmentStatusPayload({ id: ORDER_ID, toStatus, note: null })), false, `${toStatus} should be rejected`);
  }
});

test('parseUpdateOrderFulfillmentStatusPayload rejects an oversized note and an unknown field', () => {
  assert.equal(isValid(parseUpdateOrderFulfillmentStatusPayload({ id: ORDER_ID, toStatus: 'preparing', note: 'x'.repeat(501) })), false);
  assert.equal(isValid(parseUpdateOrderFulfillmentStatusPayload({ id: ORDER_ID, toStatus: 'preparing', note: null, extra: 1 })), false);
});

// --- nextFulfillmentTransitions (client-side mirror of the RPC's own CASE) ---

function order(overrides: Partial<AdminOrder>): AdminOrder {
  return { order_status: 'confirmed', fulfillment_status: 'not_started', delivery_method: 'pickup', ...overrides };
}

test('nextFulfillmentTransitions: not_started offers preparing/cancelled only', () => {
  assert.deepEqual(nextFulfillmentTransitions(order({})), ['preparing', 'cancelled']);
});

test('nextFulfillmentTransitions: preparing + pickup offers ready_for_pickup, never shipped', () => {
  const transitions = nextFulfillmentTransitions(order({ fulfillment_status: 'preparing', delivery_method: 'pickup' }));
  assert.deepEqual(transitions, ['ready_for_pickup', 'cancelled']);
});

test('nextFulfillmentTransitions: preparing + delivery offers shipped, never ready_for_pickup', () => {
  const transitions = nextFulfillmentTransitions(order({ fulfillment_status: 'preparing', delivery_method: 'delivery' }));
  assert.deepEqual(transitions, ['shipped', 'cancelled']);
});

test('nextFulfillmentTransitions: ready_for_pickup and shipped both offer only delivered/cancelled', () => {
  assert.deepEqual(nextFulfillmentTransitions(order({ fulfillment_status: 'ready_for_pickup' })), ['delivered', 'cancelled']);
  assert.deepEqual(nextFulfillmentTransitions(order({ fulfillment_status: 'shipped', delivery_method: 'delivery' })), ['delivered', 'cancelled']);
});

test('nextFulfillmentTransitions: delivered and cancelled are terminal -- no transitions offered', () => {
  assert.deepEqual(nextFulfillmentTransitions(order({ fulfillment_status: 'delivered' })), []);
  assert.deepEqual(nextFulfillmentTransitions(order({ fulfillment_status: 'cancelled' })), []);
});

test('nextFulfillmentTransitions: an order whose payment is not confirmed offers nothing, regardless of fulfillment_status', () => {
  assert.deepEqual(nextFulfillmentTransitions(order({ order_status: 'pending_payment', fulfillment_status: 'preparing' })), []);
});

// --- handler wiring contract (same substitute used throughout this suite for
// anything reachable only via a click this no-jsdom harness can't simulate) --

test('CONTRACT: the admin orders fulfillment handler calls admin_update_order_fulfillment_status with id/toStatus/note/requestId', () => {
  const source = readFileSync(join(process.cwd(), 'server/admin/handlers/orders.ts'), 'utf8');
  assert.match(source, /requireAdmin\(request, response, dependencies\)/);
  assert.match(source, /parseUpdateOrderFulfillmentStatusPayload\(auth\.body\)/);
  assert.match(source, /admin_update_order_fulfillment_status/);
  assert.match(source, /p_order_id: payload\.value\.id/);
  assert.match(source, /p_to_status: payload\.value\.toStatus/);
  assert.match(source, /p_note: payload\.value\.note/);
  assert.match(source, /p_request_id: auth\.requestId/);
});

test('CONTRACT: the fulfillment route is registered under /api/admin/orders/update-fulfillment, which the /api/404 rewrite never shadows (it only excludes "admin/")', () => {
  const dispatcher = readFileSync(join(process.cwd(), 'api/admin/[category]/[action].ts'), 'utf8');
  assert.match(dispatcher, /'orders\/update-fulfillment':\s*createAdminUpdateOrderFulfillmentStatusHandler\(\)/);
});

test('CONTRACT: the admin orders detail fetch (?id=) selects the delivery address and fulfillment history, the list fetch does not', () => {
  const source = readFileSync(join(process.cwd(), 'api/orders.ts'), 'utf8');
  assert.match(source, /ORDER_DETAIL_COLUMNS/);
  assert.match(source, /order_fulfillment_events\(from_status, to_status, note, created_at\)/);
  assert.match(source, /\.select\(ORDER_DETAIL_COLUMNS\)\.eq\('id', id\)/);
  assert.match(source, /\.select\(ORDER_COLUMNS\)\s*\n\s*\.order\('created_at'/);
});
