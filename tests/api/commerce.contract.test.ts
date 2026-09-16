import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import test from 'node:test';

import checkout, { parseCheckoutPayload } from '../../api/checkout';
import { createOrReusePreference } from '../../server/commerce/preference.js';
import webhook, { isValidSignature } from '../../api/mercadopago/webhook';
import apiNotFound from '../../api/404';
import orderStatus, { createOrderStatusHandler, parseOrderStatusPayload } from '../../api/order-status';
import { applyCors, canonicalJson, parseJsonBody, safeEqualHex, type ApiRequest, type ApiResponse } from '../../server/commerce/commerce.js';

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
  return { response, read: () => ({ statusCode, body, headers }) };
}

test('checkout DTO ignores price-like fields by rejecting them', () => {
  const valid = { items: [{ productId: '11111111-1111-4111-8111-111111111111', quantity: 1 }], customer: { email: 'guest@example.test', name: 'Guest' }, delivery: { method: 'pickup' } };
  assert.ok(parseCheckoutPayload(valid));
  assert.equal(parseCheckoutPayload({ ...valid, total: 1 }), null);
  assert.equal(parseCheckoutPayload({ ...valid, items: [{ ...valid.items[0], price: 0 }] }), null);
  assert.equal(parseCheckoutPayload({ ...valid, items: [{ ...valid.items[0], quantity: 0 }] }), null);
});

test('checkout rejects absent idempotency key before provider access', async () => {
  const result = mockResponse();
  await checkout({ method: 'POST', headers: browserHeaders(), body: {} }, result.response);
  assert.equal(result.read().statusCode, 400);
});

test('CORS fails closed in production without ALLOWED_ORIGINS', () => {
  const before = process.env.NODE_ENV;
  const allowed = process.env.ALLOWED_ORIGINS;
  process.env.NODE_ENV = 'production'; delete process.env.ALLOWED_ORIGINS;
  const result = mockResponse();
  assert.equal(applyCors({ headers: { origin: 'https://attacker.invalid' } }, result.response), false);
  process.env.NODE_ENV = before; if (allowed !== undefined) process.env.ALLOWED_ORIGINS = allowed;
});

test('CORS rejects absent Origin for browser-only endpoints', () => {
  const result = mockResponse();
  assert.equal(applyCors({ headers: {} }, result.response), false);
});

test('unknown API fallback always returns JSON 404', () => {
  const result = mockResponse();
  apiNotFound({ method: 'GET' }, result.response);
  assert.deepEqual(result.read().body, { error: 'API no encontrada.' });
  assert.equal(result.read().statusCode, 404);
});

test('webhook HMAC uses Mercado Pago signed manifest and constant-time comparison', () => {
  const secret = 'test-webhook-secret';
  const requestId = 'request-1';
  const dataId = '123456';
  const timestamp = '1704908010';
  const value = createHmac('sha256', secret).update(`id:${dataId};request-id:${requestId};ts:${timestamp};`).digest('hex');
  assert.equal(isValidSignature(`ts=${timestamp},v1=${value}`, requestId, dataId, secret), true);
  assert.equal(isValidSignature(`ts=${timestamp},v1=${'0'.repeat(64)}`, requestId, dataId, secret), false);
  assert.equal(safeEqualHex(value, value), true);
});

test('webhook rejects invalid signature before network/provider work', async () => {
  const result = mockResponse();
  await webhook({ method: 'POST', query: { 'data.id': '123' }, headers: { 'x-signature': 'bad', 'x-request-id': 'request' }, body: { type: 'payment', data: { id: '123' } } }, result.response);
  assert.equal(result.read().statusCode, 401);
});

test('canonical hashing and body limit are deterministic', () => {
  assert.equal(canonicalJson({ b: 1, a: [true, 'x'] }), canonicalJson({ a: [true, 'x'], b: 1 }));
  assert.equal(parseJsonBody('x'.repeat(20), 10), null);
});

test('order-status accepts only its strict small JSON schema', () => {
  const id = '11111111-1111-4111-8111-111111111111';
  assert.equal(parseOrderStatusPayload({ orderId: id }), id);
  assert.equal(parseOrderStatusPayload({ orderId: id, extra: true }), null);
  assert.equal(parseOrderStatusPayload({ orderId: 'not-a-uuid' }), null);
});

test('order-status rejects content type, oversized, malformed and invalid tokens before data access', async () => {
  const id = '11111111-1111-4111-8111-111111111111';
  const cases: Array<{ request: ApiRequest; expected: number }> = [
    { request: { method: 'POST', headers: browserHeaders({ 'content-type': 'text/plain' }), body: { orderId: id } }, expected: 415 },
    { request: { method: 'POST', headers: browserHeaders({ 'content-length': '513' }), body: 'x'.repeat(513) }, expected: 404 },
    { request: { method: 'POST', headers: browserHeaders(), body: chunked('x'.repeat(513)) }, expected: 404 },
    { request: { method: 'POST', headers: browserHeaders(), body: '{' }, expected: 404 },
    { request: { method: 'POST', headers: browserHeaders({ 'x-order-status-token': 'short' }), body: { orderId: id } }, expected: 404 },
    { request: { method: 'GET', headers: browserHeaders(), body: { orderId: id } }, expected: 405 },
  ];
  for (const item of cases) {
    const result = mockResponse();
    await orderStatus(item.request, result.response);
    assert.equal(result.read().statusCode, item.expected);
  }
});

test('order-status keeps a generic response for absent orders and rate limits', async () => {
  const id = '11111111-1111-4111-8111-111111111111';
  const chain = { select: () => chain, eq: () => chain, maybeSingle: async () => ({ data: null, error: null }) };
  const missingOrder = createOrderStatusHandler({
    serviceClient: (() => ({ from: () => chain })) as never,
    consumeRateLimit: (async () => ({ ok: true, retryAfter: 0, unavailable: false })) as never,
  });
  const missingResult = mockResponse();
  await missingOrder({ method: 'POST', headers: browserHeaders(), body: { orderId: id } }, missingResult.response);
  assert.equal(missingResult.read().statusCode, 404);

  const limited = createOrderStatusHandler({
    serviceClient: (() => ({ from: () => chain })) as never,
    consumeRateLimit: (async () => ({ ok: false, retryAfter: 12, unavailable: false })) as never,
  });
  const limitedResult = mockResponse();
  await limited({ method: 'POST', headers: browserHeaders(), body: { orderId: id } }, limitedResult.response);
  assert.equal(limitedResult.read().statusCode, 429);
  assert.equal(limitedResult.read().headers.get('Retry-After'), '12');
});

test('preference lease allows one provider call and reuses the stored result', async () => {
  let owner = false;
  let providerCalls = 0;
  const gateway = {
    async claim() { return owner ? { claim_status: 'processing' } : (owner = true, { claim_status: 'claimed', provider_idempotency_key: 'stable-order-key' }); },
    async complete(_token: string, id: string, url: string) { return { claim_status: 'ready', preference_id: id, checkout_url: url }; },
    async fail() {},
  };
  const provider = { async create() { providerCalls++; return { id: 'pref-1', checkoutUrl: 'https://checkout.example.test/1' }; } };
  const first = await createOrReusePreference(gateway, provider, 'lease-1');
  const second = await createOrReusePreference(gateway, provider, 'lease-2');
  assert.equal(first.status, 'ready');
  assert.equal(second.status, 'processing');
  assert.equal(providerCalls, 1);
  const reuse = await createOrReusePreference({ ...gateway, async claim() { return { claim_status: 'ready', preference_id: 'pref-1', checkout_url: 'https://checkout.example.test/1' }; } }, provider, 'lease-3');
  assert.equal(reuse.status, 'ready');
  assert.equal(providerCalls, 1);
});

test('preference provider failures require controlled reconciliation', async () => {
  let failed = 0;
  const result = await createOrReusePreference({
    async claim() { return { claim_status: 'claimed' }; },
    async complete() { throw new Error('not reached'); },
    async fail() { failed++; },
  }, { async create() { throw new Error('timeout'); } }, 'lease-1');
  assert.equal(result.status, 'failed');
  assert.equal(failed, 1);
});

function browserHeaders(extra: Record<string, string> = {}) {
  return { origin: 'http://localhost:5173', 'content-type': 'application/json', 'x-order-status-token': 'a'.repeat(43), ...extra };
}

async function* chunked(value: string) {
  yield value.slice(0, 200);
  yield value.slice(200);
}
