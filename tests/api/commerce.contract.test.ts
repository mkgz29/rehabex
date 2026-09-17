import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import test from 'node:test';

import checkout, { parseCheckoutPayload } from '../../api/checkout';
import reconcilePayment, { createReconcilePaymentHandler, parseReconcilePaymentPayload } from '../../api/admin/reconcile-payment';
import { createOrReusePreference } from '../../server/commerce/preference.js';
import webhook, { diagnoseSignature, isValidSignature, normalizeWebhookResourceId, parseSignature, webhookResource } from '../../api/mercadopago/webhook';
import apiNotFound from '../../api/404';
import orderStatus, { createOrderStatusHandler, parseOrderStatusPayload } from '../../api/order-status';
import { applyCors, canonicalJson, parseJsonBody, safeEqualHex, type ApiRequest, type ApiResponse } from '../../server/commerce/commerce.js';
import { processMercadoPagoPayment, type MercadoPagoPayment, type PaymentRepository } from '../../server/commerce/paymentProcessing.js';

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
  const valid = { items: [{ productId: '11111111-1111-4111-8111-111111111111', quantity: 1 }], customer: { email: 'guest@example.test', name: 'Guest', phone: '11 5555 1234' }, delivery: { method: 'pickup' } };
  assert.ok(parseCheckoutPayload(valid));
  assert.equal(parseCheckoutPayload({ ...valid, total: 1 }), null);
  assert.equal(parseCheckoutPayload({ ...valid, items: [{ ...valid.items[0], price: 0 }] }), null);
  assert.equal(parseCheckoutPayload({ ...valid, items: [{ ...valid.items[0], quantity: 0 }] }), null);
  assert.equal(parseCheckoutPayload({ ...valid, customer: { email: 'guest@example.test', name: 'Guest' } }), null);
  assert.equal(parseCheckoutPayload({ ...valid, customer: { email: 'guest@other-domain.test', name: 'Guest', phone: '11 5555 1234' } })?.customer.email, 'guest@other-domain.test');
  assert.equal(parseCheckoutPayload({ ...valid, delivery: { method: 'delivery', recipientName: 'Destinatario', addressLine1: 'Calle 1', city: 'Ciudad', province: 'Provincia', postalCode: '1000' } })?.delivery.recipientName, 'Destinatario');
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

test('webhook manifest is byte-exact; non-official variants are diagnostic only', () => {
  const secret = 'synthetic-test-secret';
  const requestId = 'req-synthetic';
  const rawId = 'PAYMENTABC123';
  const id = normalizeWebhookResourceId(rawId);
  const timestamp = '1704908010';
  const resource = webhookResource({ query: { 'data.id': rawId } });
  assert.notEqual(resource.resourceId, null);
  if (!resource.resourceId) throw new Error('test resource missing');
  const digest = createHmac('sha256', secret).update(`id:${id};request-id:${requestId};ts:${timestamp};`, 'utf8').digest('hex');
  assert.equal(isValidSignature(`v1=${digest}, ts=${timestamp}`, requestId, rawId, secret), true);
  assert.deepEqual(parseSignature(`v1=${digest}, ts=${timestamp}`), { timestamp, digest, reason: 'ok' });
  assert.equal(normalizeWebhookResourceId(rawId), 'paymentabc123');
  assert.equal(isValidSignature(`ts=${timestamp},v1=${digest}`, requestId, rawId, 'other-secret'), false);
  assert.deepEqual(diagnoseSignature(`ts=${timestamp},v1=${digest}`, requestId, resource, secret), {
    secretLength: secret.length,
    secretHasLeadingWhitespace: false,
    secretHasTrailingWhitespace: false,
    secretHasLineBreak: false,
    canonicalVariantMatch: 'official_data_id',
    officialValid: true,
  });

  const noTerminator = createHmac('sha256', secret).update(`id:${id};request-id:${requestId};ts:${timestamp}`, 'utf8').digest('hex');
  assert.equal(isValidSignature(`ts=${timestamp},v1=${noTerminator}`, requestId, rawId, secret), false);
  assert.equal(diagnoseSignature(`ts=${timestamp},v1=${noTerminator}`, requestId, resource, secret).canonicalVariantMatch, 'data_id_without_final_semicolon');

  const originalCase = createHmac('sha256', secret).update(`id:${rawId};request-id:${requestId};ts:${timestamp};`, 'utf8').digest('hex');
  assert.equal(isValidSignature(`ts=${timestamp},v1=${originalCase}`, requestId, rawId, secret), false);
  assert.equal(diagnoseSignature(`ts=${timestamp},v1=${originalCase}`, requestId, resource, secret).canonicalVariantMatch, 'data_id_original_case');

  assert.equal(parseSignature(`v1=${digest}`).reason, 'signature_timestamp_missing');
  assert.equal(parseSignature(`ts=${timestamp}`).reason, 'signature_digest_missing');
});

test('webhook uses one non-ambiguous query resource id and rejects legacy unsigned requests', async () => {
  const fromDataId = webhookResource({ query: { 'data.id': '123456789012' } });
  assert.deepEqual(fromDataId, { resourceId: '123456789012', rawResourceId: '123456789012', source: 'data.id', reason: null });
  const fromAlias = webhookResource({ query: { id: '234567890123' } });
  assert.deepEqual(fromAlias, { resourceId: '234567890123', rawResourceId: '234567890123', source: 'id', reason: null });
  assert.equal(webhookResource({ query: { 'data.id': '1', id: '1' } }).reason, 'resource_id_ambiguous');
  assert.equal(webhookResource({ query: { 'data.id': ['1', '2'] } }).reason, 'resource_id_ambiguous');
  assert.equal(webhookResource({ query: { 'data.id': ['1', '1'] } }).reason, 'resource_id_ambiguous');

  const result = mockResponse();
  await webhook({ method: 'POST', query: { 'data.id': '123456789012' }, headers: { 'X-Request-Id': 'request-1' }, body: { type: 'payment', data: { id: 'ignored' } } }, result.response);
  assert.equal(result.read().statusCode, 401);
  const missingRequestId = mockResponse();
  await webhook({ method: 'POST', query: { 'data.id': '123456789012' }, headers: { 'X-Signature': 'ts=1704908010,v1=0'.padEnd(82, '0') }, body: { type: 'payment' } }, missingRequestId.response);
  assert.equal(missingRequestId.read().statusCode, 401);
});

test('webhook accepts case-insensitive headers for a signed data.id notification', async () => {
  const before = process.env.MERCADOPAGO_WEBHOOK_SECRET;
  const secret = 'synthetic-test-secret';
  process.env.MERCADOPAGO_WEBHOOK_SECRET = secret;
  const timestamp = '1704908010';
  const requestId = 'request-1';
  const id = 'PAYMENTABC123';
  const normalizedId = normalizeWebhookResourceId(id);
  const digest = createHmac('sha256', secret).update(`id:${normalizedId};request-id:${requestId};ts:${timestamp};`).digest('hex');
  const result = mockResponse();
  await webhook({ method: 'POST', query: { 'data.id': id }, headers: { 'X-Signature': `v1=${digest},ts=${timestamp}`, 'X-Request-Id': requestId }, body: { type: 'merchant_order', data: { id } } }, result.response);
  assert.equal(result.read().statusCode, 200);
  if (before === undefined) delete process.env.MERCADOPAGO_WEBHOOK_SECRET; else process.env.MERCADOPAGO_WEBHOOK_SECRET = before;
});

test('webhook records but rejects the id alias even when its HMAC matches', async () => {
  const before = process.env.MERCADOPAGO_WEBHOOK_SECRET;
  const secret = 'synthetic-test-secret';
  process.env.MERCADOPAGO_WEBHOOK_SECRET = secret;
  const timestamp = '1704908010';
  const requestId = 'request-legacy';
  const id = '123456789012';
  const digest = createHmac('sha256', secret).update(`id:${id};request-id:${requestId};ts:${timestamp};`, 'utf8').digest('hex');
  const result = mockResponse();
  await webhook({ method: 'POST', query: { id }, headers: { 'x-signature': `ts=${timestamp},v1=${digest}`, 'x-request-id': requestId }, body: { type: 'payment', data: { id } } }, result.response);
  assert.equal(result.read().statusCode, 401);
  if (before === undefined) delete process.env.MERCADOPAGO_WEBHOOK_SECRET; else process.env.MERCADOPAGO_WEBHOOK_SECRET = before;
});

test('webhook signs the exact runtime request-id and only reports secret shape', async () => {
  const before = process.env.MERCADOPAGO_WEBHOOK_SECRET;
  const secret = ' secret-with-newline\n';
  process.env.MERCADOPAGO_WEBHOOK_SECRET = secret;
  const timestamp = '1704908010';
  const requestId = ' request-id-as-received ';
  const id = '123456789012';
  const digest = createHmac('sha256', secret).update(`id:${id};request-id:${requestId};ts:${timestamp};`, 'utf8').digest('hex');
  const result = mockResponse();
  await webhook({ method: 'POST', query: { 'data.id': id }, headers: { 'x-signature': `ts=${timestamp},v1=${digest}`, 'x-request-id': requestId }, body: { type: 'merchant_order' } }, result.response);
  assert.equal(result.read().statusCode, 200);
  const resource = webhookResource({ query: { 'data.id': id } });
  assert.notEqual(resource.resourceId, null);
  if (!resource.resourceId) throw new Error('test resource missing');
  const diagnostic = diagnoseSignature(`ts=${timestamp},v1=${digest}`, requestId, resource, secret);
  assert.deepEqual({
    secretLength: diagnostic.secretLength,
    secretHasLeadingWhitespace: diagnostic.secretHasLeadingWhitespace,
    secretHasTrailingWhitespace: diagnostic.secretHasTrailingWhitespace,
    secretHasLineBreak: diagnostic.secretHasLineBreak,
  }, { secretLength: secret.length, secretHasLeadingWhitespace: true, secretHasTrailingWhitespace: true, secretHasLineBreak: true });
  assert.equal(webhookResource({ query: { 'data.id': ` ${id}` } }).reason, 'resource_id_invalid');
  if (before === undefined) delete process.env.MERCADOPAGO_WEBHOOK_SECRET; else process.env.MERCADOPAGO_WEBHOOK_SECRET = before;
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

const reconcileOrderId = '0f7268a7-2559-4d78-a491-4a6cb126a3c3';

function providerPayment(overrides: Partial<MercadoPagoPayment> = {}): MercadoPagoPayment {
  return {
    id: '179368065874',
    status: 'approved',
    transaction_amount: 100,
    currency_id: 'ARS',
    external_reference: reconcileOrderId,
    preference_id: 'pref-test',
    live_mode: false,
    ...overrides,
  };
}

function paymentRepository(options: { duplicate?: boolean; outcome?: string | null; error?: boolean } = {}) {
  const calls = { atomic: 0 };
  const repository: PaymentRepository = {
    async processAtomic() {
      calls.atomic++;
      return {
        eventId: '11111111-1111-4111-8111-111111111111',
        outcome: options.outcome ?? (options.duplicate ? 'duplicate' : 'approved'),
        duplicate: Boolean(options.duplicate),
        error: Boolean(options.error),
      };
    },
  };
  return { repository, calls };
}

function reconcileHeaders(extra: Record<string, string> = {}) {
  return {
    origin: 'http://localhost:5173',
    'content-type': 'application/json',
    authorization: 'Bearer valid-session-token',
    'x-vercel-forwarded-for': '203.0.113.10',
    ...extra,
  };
}

function reconcileHandler(overrides: Record<string, unknown> = {}) {
  return createReconcilePaymentHandler({
    serviceClient: () => ({}) as never,
    authorize: async () => ({ kind: 'admin', userId: '11111111-1111-4111-8111-111111111111' }),
    consumeRateLimit: async () => ({ ok: true, retryAfter: 0, unavailable: false }),
    fetchPayment: async () => ({ kind: 'ok', payment: providerPayment() }),
    processPayment: async () => ({ kind: 'processed', status: 'approved', transition: 'approved' }),
    ...overrides,
  });
}

async function withAccessToken(run: () => Promise<void>) {
  const before = process.env.MERCADOPAGO_ACCESS_TOKEN;
  process.env.MERCADOPAGO_ACCESS_TOKEN = 'synthetic-access-token';
  try { await run(); } finally {
    if (before === undefined) delete process.env.MERCADOPAGO_ACCESS_TOKEN; else process.env.MERCADOPAGO_ACCESS_TOKEN = before;
  }
}

test('admin reconciliation requires a valid admin session and strict small payload', async () => {
  assert.deepEqual(parseReconcilePaymentPayload({ paymentId: '179368065874' }), { paymentId: '179368065874' });
  assert.equal(parseReconcilePaymentPayload({ paymentId: '179368065874', orderId: reconcileOrderId }), null);
  assert.equal(parseReconcilePaymentPayload({ paymentId: ' 179368065874' }), null);

  const missing = mockResponse();
  await reconcilePayment({ method: 'POST', headers: { origin: 'http://localhost:5173', 'content-type': 'application/json' }, body: { paymentId: '179368065874' } }, missing.response);
  assert.equal(missing.read().statusCode, 401);

  await withAccessToken(async () => {
    const invalidHandler = reconcileHandler({ authorize: async () => ({ kind: 'unauthorized' }) });
    const invalid = mockResponse();
    await invalidHandler({ method: 'POST', headers: reconcileHeaders(), body: { paymentId: '179368065874' } }, invalid.response);
    assert.equal(invalid.read().statusCode, 401);

    const nonAdminHandler = reconcileHandler({ authorize: async () => ({ kind: 'forbidden' }) });
    const nonAdmin = mockResponse();
    await nonAdminHandler({ method: 'POST', headers: reconcileHeaders(), body: { paymentId: '179368065874' } }, nonAdmin.response);
    assert.equal(nonAdmin.read().statusCode, 403);

    const invalidBody = mockResponse();
    await reconcileHandler()({ method: 'POST', headers: reconcileHeaders(), body: { paymentId: '179368065874', status: 'approved' } }, invalidBody.response);
    assert.equal(invalidBody.read().statusCode, 400);
  });
});

test('admin reconciliation keeps provider failures generic and applies CORS/rate limits', async () => {
  await withAccessToken(async () => {
    const notFound = mockResponse();
    await reconcileHandler({ fetchPayment: async () => ({ kind: 'not_found' }) })({ method: 'POST', headers: reconcileHeaders(), body: { paymentId: '179368065874' } }, notFound.response);
    assert.equal(notFound.read().statusCode, 404);

    const limited = mockResponse();
    await reconcileHandler({ consumeRateLimit: async () => ({ ok: false, retryAfter: 9, unavailable: false }) })({ method: 'POST', headers: reconcileHeaders(), body: { paymentId: '179368065874' } }, limited.response);
    assert.equal(limited.read().statusCode, 429);
    assert.equal(limited.read().headers.get('Retry-After'), '9');

    const preflight = mockResponse();
    await reconcileHandler()({ method: 'OPTIONS', headers: { origin: 'http://localhost:5173' } }, preflight.response);
    assert.equal(preflight.read().statusCode, 204);
    assert.equal(preflight.read().headers.get('Access-Control-Allow-Headers'), 'Content-Type, Authorization');
  });
});

test('admin reconciliation raw body reaches auth and rejects malformed or oversized input safely', async () => {
  let providerCalls = 0;
  const handler = reconcileHandler({
    fetchPayment: async () => { providerCalls++; return { kind: 'not_found' }; },
  });

  const validUnauthenticated = mockResponse();
  await handler({
    method: 'POST',
    headers: { origin: 'http://localhost:5173', 'content-type': 'application/json' },
    body: chunked(JSON.stringify({ paymentId: '179368065874' })),
  }, validUnauthenticated.response);
  assert.equal(validUnauthenticated.read().statusCode, 401);
  assert.equal(providerCalls, 0);

  const malformed = mockResponse();
  await handler({ method: 'POST', headers: reconcileHeaders(), body: chunked('{"paymentId":') }, malformed.response);
  assert.equal(malformed.read().statusCode, 400);
  assert.equal(providerCalls, 0);

  const oversized = mockResponse();
  await handler({ method: 'POST', headers: reconcileHeaders(), body: chunked(JSON.stringify({ paymentId: 'x'.repeat(600) })) }, oversized.response);
  assert.equal(oversized.read().statusCode, 413);
  assert.equal(providerCalls, 0);

  const wrongMethod = mockResponse();
  await handler({ method: 'GET', headers: { origin: 'http://localhost:5173' } }, wrongMethod.response);
  assert.equal(wrongMethod.read().statusCode, 405);

  const preflight = mockResponse();
  await handler({ method: 'OPTIONS', headers: { origin: 'http://localhost:5173' } }, preflight.response);
  assert.equal(preflight.read().statusCode, 204);
});

test('authenticated reconciliation parses exactly paymentId from a raw JSON stream', async () => {
  await withAccessToken(async () => {
    let receivedPaymentId: string | null = null;
    const handler = reconcileHandler({
      fetchPayment: async (paymentId: string) => {
        receivedPaymentId = paymentId;
        return { kind: 'not_found' };
      },
    });
    const result = mockResponse();
    await handler({ method: 'POST', headers: reconcileHeaders(), body: chunked(JSON.stringify({ paymentId: '179368065874' })) }, result.response);
    assert.equal(result.read().statusCode, 404);
    assert.equal(receivedPaymentId, '179368065874');
  });
});

test('shared atomic processor maps database validation outcomes and always enforces TEST mode', async () => {
  const cases: Array<[MercadoPagoPayment, string, string]> = [
    [providerPayment({ live_mode: true }), 'rejected_test_mode', 'test_mode_required'],
    [providerPayment({ external_reference: '11111111-1111-4111-8111-111111111111' }), 'rejected_order_not_found', 'order_not_found'],
    [providerPayment({ preference_id: 'other' }), 'rejected_preference_mismatch', 'preference_mismatch'],
    [providerPayment({ transaction_amount: 101 }), 'rejected_amount_mismatch', 'amount_mismatch'],
    [providerPayment({ currency_id: 'USD' }), 'rejected_currency_mismatch', 'currency_mismatch'],
    [providerPayment(), 'rejected_payment_id_mismatch', 'payment_id_mismatch'],
  ];
  for (const [payment, outcome, reason] of cases) {
    const { repository, calls } = paymentRepository({ outcome });
    const result = await processMercadoPagoPayment(repository, payment, { requestId: null });
    assert.deepEqual(result, { kind: 'rejected', reason });
    assert.deepEqual(calls, { atomic: 1 });
  }

  const invalid = paymentRepository();
  assert.deepEqual(await processMercadoPagoPayment(invalid.repository, providerPayment({ id: '' }), { requestId: null }), { kind: 'rejected', reason: 'payment_shape_invalid' });
  assert.deepEqual(invalid.calls, { atomic: 0 });
});

test('shared atomic processor applies approved and pending provider states through one call', async () => {
  const approved = paymentRepository();
  const approvedResult = await processMercadoPagoPayment(approved.repository, providerPayment(), { requestId: null });
  assert.deepEqual(approvedResult, { kind: 'processed', status: 'approved', transition: 'approved' });
  assert.deepEqual(approved.calls, { atomic: 1 });

  const pending = paymentRepository({ outcome: 'pending' });
  const pendingResult = await processMercadoPagoPayment(pending.repository, providerPayment({ status: 'pending' }), { requestId: null });
  assert.deepEqual(pendingResult, { kind: 'processed', status: 'pending', transition: 'pending' });
  assert.deepEqual(pending.calls, { atomic: 1 });
});

test('shared reconciliation is idempotent and preserves out-of-order transition authority', async () => {
  const duplicate = paymentRepository({ duplicate: true });
  const duplicateResult = await processMercadoPagoPayment(duplicate.repository, providerPayment(), { requestId: null });
  assert.deepEqual(duplicateResult, { kind: 'duplicate', status: 'approved' });
  assert.deepEqual(duplicate.calls, { atomic: 1 });

  const outOfOrder = paymentRepository({ outcome: 'ignored_invalid_transition' });
  const outOfOrderResult = await processMercadoPagoPayment(outOfOrder.repository, providerPayment({ status: 'pending' }), { requestId: null });
  assert.deepEqual(outOfOrderResult, { kind: 'rejected', reason: 'transition_invalid' });
  assert.deepEqual(outOfOrder.calls, { atomic: 1 });
});

test('duplicate reconciliation never invokes a second stock-affecting transition', async () => {
  let processed = false;
  let stock = 1;
  const repository: PaymentRepository = {
    async processAtomic() {
      if (processed) return { eventId: '11111111-1111-4111-8111-111111111111', outcome: 'duplicate', duplicate: true, error: false };
      processed = true;
      assert.ok(stock > 0);
      stock--;
      return { eventId: '11111111-1111-4111-8111-111111111111', outcome: 'approved', duplicate: false, error: false };
    },
  };
  const first = await processMercadoPagoPayment(repository, providerPayment(), { requestId: 'webhook-request' });
  const second = await processMercadoPagoPayment(repository, providerPayment(), { requestId: null });
  assert.equal(first.kind, 'processed');
  assert.equal(second.kind, 'duplicate');
  assert.equal(stock, 0);
});
