import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

import { createOrderStatusHandler } from '../../api/order-status';
import { hash, type ApiResponse } from '../../server/commerce/commerce.js';

const ORDER_ID = '11111111-1111-4111-8111-111111111111';
const SESSION_TOKEN = 'a'.repeat(43);
const TRACKING_TOKEN = 'b'.repeat(43);

function browserHeaders(token: string) {
  return { origin: 'http://localhost:5173', 'content-type': 'application/json', 'x-order-status-token': token };
}

function mockResponse() {
  let statusCode = 0;
  let body: unknown;
  const headers = new Map<string, string | string[]>();
  const response: ApiResponse = {
    status(code) { statusCode = code; return response; },
    json(value) { body = value; },
    end() {},
    setHeader(name, value) { headers.set(name, value); },
  };
  return { response, read: () => ({ statusCode, body: body as any, headers }) };
}

/** FASE 7F-B4: orders.status_access_token_hash OR orders.tracking_token_hash -- same order either way. */
function supabaseMock(options: { orderRow: Record<string, unknown> | null; events?: unknown[] }) {
  const calls: { or: string[]; fromTables: string[] } = { or: [], fromTables: [] };
  const client = {
    from(table: string) {
      calls.fromTables.push(table);
      if (table === 'orders') {
        return {
          select() {
            return {
              eq() {
                return {
                  or(filter: string) {
                    calls.or.push(filter);
                    return { maybeSingle: async () => ({ data: options.orderRow, error: null }) };
                  },
                };
              },
            };
          },
        };
      }
      if (table === 'order_fulfillment_events') {
        return { select() { return { eq() { return { order: async () => ({ data: options.events ?? [], error: null }) }; } }; } };
      }
      throw new Error(`unexpected table: ${table}`);
    },
  };
  return { client, calls };
}

function handler(options: { orderRow: Record<string, unknown> | null; events?: unknown[] }) {
  const mock = supabaseMock(options);
  return {
    handler: createOrderStatusHandler({
      serviceClient: (() => mock.client) as never,
      consumeRateLimit: (async () => ({ ok: true, retryAfter: 0, unavailable: false })) as never,
    }),
    calls: mock.calls,
  };
}

const ORDER_ROW = { id: ORDER_ID, order_number: 'RHB-202610-000008', payment_status: 'approved', order_status: 'confirmed', fulfillment_status: 'preparing', delivery_method: 'pickup', total_amount: 100, currency: 'ARS', refund_required: false, created_at: '2026-10-01T00:00:00Z' };

test('order-status: a token matching status_access_token_hash finds the order (the live checkout-session path, unchanged)', async () => {
  const { handler: h } = handler({ orderRow: ORDER_ROW });
  const result = mockResponse();
  await h({ method: 'POST', headers: browserHeaders(SESSION_TOKEN), body: { orderId: ORDER_ID } } as never, result.response);
  assert.equal(result.read().statusCode, 200);
  assert.equal((result.read().body as any).order.id, ORDER_ID);
});

test('order-status: a token matching tracking_token_hash ALSO finds the order (the emailed "Ver mi pedido" link path)', async () => {
  const { handler: h, calls } = handler({ orderRow: ORDER_ROW });
  const result = mockResponse();
  await h({ method: 'POST', headers: browserHeaders(TRACKING_TOKEN), body: { orderId: ORDER_ID } } as never, result.response);
  assert.equal(result.read().statusCode, 200);
  // Same single .or() filter is used for either token -- only the hash value changes per request.
  assert.equal(calls.or[0], `status_access_token_hash.eq.${hash(TRACKING_TOKEN)},tracking_token_hash.eq.${hash(TRACKING_TOKEN)}`);
});

test('order-status: response includes delivery_method and a fulfillmentTimeline array', async () => {
  const events = [{ to_status: 'not_started', created_at: '2026-10-01T00:00:00Z' }, { to_status: 'preparing', created_at: '2026-10-02T00:00:00Z' }];
  const { handler: h } = handler({ orderRow: ORDER_ROW, events });
  const result = mockResponse();
  await h({ method: 'POST', headers: browserHeaders(SESSION_TOKEN), body: { orderId: ORDER_ID } } as never, result.response);
  const body = result.read().body as any;
  assert.equal(body.order.delivery_method, 'pickup');
  assert.deepEqual(body.fulfillmentTimeline, events);
});

test('order-status: the timeline never includes note or created_by (internal/admin fields)', async () => {
  const { handler: h } = handler({ orderRow: ORDER_ROW, events: [{ to_status: 'preparing', created_at: '2026-10-02T00:00:00Z' }] });
  const result = mockResponse();
  await h({ method: 'POST', headers: browserHeaders(SESSION_TOKEN), body: { orderId: ORDER_ID } } as never, result.response);
  const body = result.read().body as any;
  for (const event of body.fulfillmentTimeline) {
    assert.deepEqual(Object.keys(event).sort(), ['created_at', 'to_status']);
  }
});

test('order-status: no order found (bad token or id) still responds 404 generically, never a 500 from the events query', async () => {
  const { handler: h } = handler({ orderRow: null });
  const result = mockResponse();
  await h({ method: 'POST', headers: browserHeaders(SESSION_TOKEN), body: { orderId: ORDER_ID } } as never, result.response);
  assert.equal(result.read().statusCode, 404);
});

test('CONTRACT: order-status never selects internal order columns (hashes, payment ids/provider internals, customer PII)', () => {
  const source = readFileSync(join(process.cwd(), 'api/order-status.ts'), 'utf8');
  const selectCall = source.match(/\.from\('orders'\)\s*\n\s*\.select\('([^']+)'\)/);
  assert.ok(selectCall, 'expected a single-line .select(...) on orders');
  const columns = selectCall![1].split(',').map((c) => c.trim());
  for (const forbidden of ['status_access_token_hash', 'tracking_token_hash', 'mercadopago_payment_id', 'mercadopago_preference_id', 'customer_email', 'customer_phone', 'customer_name', 'idempotency_key']) {
    assert.ok(!columns.includes(forbidden), `order-status selects ${forbidden}`);
  }
  // And the fulfillment events query never asks for note/created_by either.
  const eventsCall = source.match(/\.from\('order_fulfillment_events'\)\s*\n\s*\.select\('([^']+)'\)/);
  assert.ok(eventsCall, 'expected a single-line .select(...) on order_fulfillment_events');
  const eventColumns = eventsCall![1].split(',').map((c) => c.trim());
  assert.deepEqual(eventColumns, ['to_status', 'created_at']);
});
