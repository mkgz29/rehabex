import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import test from 'node:test';

import checkout, { buildPreferenceBody, parseCheckoutPayload } from '../../api/checkout';
import reconcilePayment, { createReconcilePaymentHandler, parseReconcilePaymentPayload } from '../../api/admin/reconcile-payment';
import { createOrReusePreference } from '../../server/commerce/preference.js';
import webhook, { webhookResource } from '../../api/mercadopago/webhook';
import apiNotFound from '../../api/404';
import orderStatus, { createOrderStatusHandler, parseOrderStatusPayload } from '../../api/order-status';
import { applyCors, backendUrls, canonicalJson, parseJsonBody, type ApiRequest, type ApiResponse } from '../../server/commerce/commerce.js';
import { processMercadoPagoPayment, type MercadoPagoPayment, type PaymentRepository } from '../../server/commerce/paymentProcessing.js';
import { adaptMercadoPagoPayment, fetchMercadoPagoPayment } from '../../server/commerce/mercadoPagoPayment.js';

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

const OFFICIAL_SECRET = 'synthetic-test-secret';

/**
 * Rebuilds the manifest documented by Mercado Pago (`id:<data.id>;request-id:<x-request-id>;ts:<ts>;`)
 * so these tests assert the handler against the published contract, not against itself.
 */
function officialSignature(dataId: string, requestId: string, timestamp: string, secret = OFFICIAL_SECRET) {
  const manifest = `id:${dataId.toLowerCase()};request-id:${requestId};ts:${timestamp};`;
  return `ts=${timestamp},v1=${createHmac('sha256', secret).update(manifest).digest('hex')}`;
}

function digestOf(signature: string) {
  return signature.split('v1=')[1];
}

async function withWebhookSecret(secret: string | undefined, run: () => Promise<void>) {
  const before = process.env.MERCADOPAGO_WEBHOOK_SECRET;
  if (secret === undefined) delete process.env.MERCADOPAGO_WEBHOOK_SECRET;
  else process.env.MERCADOPAGO_WEBHOOK_SECRET = secret;
  try { await run(); } finally {
    if (before === undefined) delete process.env.MERCADOPAGO_WEBHOOK_SECRET;
    else process.env.MERCADOPAGO_WEBHOOK_SECRET = before;
  }
}

async function webhookStatus(request: ApiRequest) {
  const result = mockResponse();
  await webhook(request, result.response);
  return result.read().statusCode;
}

test('webhook accepts an official signed data.id notification through the SDK validator', async () => {
  await withWebhookSecret(OFFICIAL_SECRET, async () => {
    const dataId = '178628386843';
    const requestId = '9f1c2a44-0d1e-4f3b-8c0a-1b2c3d4e5f60';
    const timestamp = '1704908010';
    const signature = officialSignature(dataId, requestId, timestamp);
    assert.equal(await webhookStatus({
      method: 'POST',
      query: { 'data.id': dataId },
      headers: { 'X-Signature': signature, 'X-Request-Id': requestId },
      body: { type: 'merchant_order', data: { id: dataId } },
    }), 200);

    // Header casing and component order are not part of the signed material.
    assert.equal(await webhookStatus({
      method: 'POST',
      query: { 'data.id': dataId },
      headers: { 'x-signature': `v1=${digestOf(signature)}, ts=${timestamp}`, 'x-request-id': requestId },
      body: { type: 'merchant_order', data: { id: dataId } },
    }), 200);
  });
});

test('webhook answers 401 to every invalid signature without touching the provider', async () => {
  await withWebhookSecret(OFFICIAL_SECRET, async () => {
    const dataId = '178628386843';
    const requestId = 'req-invalid';
    const timestamp = '1704908010';
    const cases: ApiRequest[] = [
      // Signed with a different secret.
      { method: 'POST', query: { 'data.id': dataId }, headers: { 'x-signature': officialSignature(dataId, requestId, timestamp, 'another-secret'), 'x-request-id': requestId }, body: { type: 'payment', data: { id: dataId } } },
      // Digest replaced.
      { method: 'POST', query: { 'data.id': dataId }, headers: { 'x-signature': `ts=${timestamp},v1=${'0'.repeat(64)}`, 'x-request-id': requestId }, body: { type: 'payment' } },
      // Valid digest bound to a different request id.
      { method: 'POST', query: { 'data.id': dataId }, headers: { 'x-signature': officialSignature(dataId, 'other-request', timestamp), 'x-request-id': requestId }, body: { type: 'payment' } },
      // Valid digest bound to a different data.id.
      { method: 'POST', query: { 'data.id': dataId }, headers: { 'x-signature': officialSignature('178629538119', requestId, timestamp), 'x-request-id': requestId }, body: { type: 'payment' } },
      // Valid digest replayed under a different timestamp.
      { method: 'POST', query: { 'data.id': dataId }, headers: { 'x-signature': `ts=1704908011,v1=${digestOf(officialSignature(dataId, requestId, timestamp))}`, 'x-request-id': requestId }, body: { type: 'payment' } },
      // Unparseable header.
      { method: 'POST', query: { 'data.id': dataId }, headers: { 'x-signature': 'bad', 'x-request-id': requestId }, body: { type: 'payment' } },
    ];
    for (const request of cases) assert.equal(await webhookStatus(request), 401);
  });
});

test('webhook fails closed when any signed field or the panel secret is absent', async () => {
  const dataId = '178628386843';
  const requestId = 'req-absent';
  const timestamp = '1704908010';
  const signature = officialSignature(dataId, requestId, timestamp);
  await withWebhookSecret(OFFICIAL_SECRET, async () => {
    const cases: ApiRequest[] = [
      // No x-signature.
      { method: 'POST', query: { 'data.id': dataId }, headers: { 'x-request-id': requestId }, body: { type: 'payment' } },
      // No x-request-id.
      { method: 'POST', query: { 'data.id': dataId }, headers: { 'x-signature': signature }, body: { type: 'payment' } },
      // No data.id.
      { method: 'POST', query: {}, headers: { 'x-signature': signature, 'x-request-id': requestId }, body: { type: 'payment' } },
      // No ts component.
      { method: 'POST', query: { 'data.id': dataId }, headers: { 'x-signature': `v1=${digestOf(signature)}`, 'x-request-id': requestId }, body: { type: 'payment' } },
      // No v1 component.
      { method: 'POST', query: { 'data.id': dataId }, headers: { 'x-signature': `ts=${timestamp}`, 'x-request-id': requestId }, body: { type: 'payment' } },
      // Duplicated query value.
      { method: 'POST', query: { 'data.id': [dataId, dataId] }, headers: { 'x-signature': signature, 'x-request-id': requestId }, body: { type: 'payment' } },
      // Duplicated header value.
      { method: 'POST', query: { 'data.id': dataId }, headers: { 'x-signature': [signature, signature], 'x-request-id': requestId }, body: { type: 'payment' } },
    ];
    for (const request of cases) assert.equal(await webhookStatus(request), 401);
  });

  // An unset panel secret can never be read as an accepted notification.
  await withWebhookSecret(undefined, async () => {
    assert.equal(await webhookStatus({ method: 'POST', query: { 'data.id': dataId }, headers: { 'x-signature': signature, 'x-request-id': requestId }, body: { type: 'payment' } }), 401);
  });
});

test('webhook rejects legacy id + topic notifications on the unsignable IPN channel', async () => {
  await withWebhookSecret(OFFICIAL_SECRET, async () => {
    const dataId = '178628386843';
    const requestId = 'req-legacy';
    const timestamp = '1704908010';
    const signature = officialSignature(dataId, requestId, timestamp);
    const entries = await captureConsoleInfo(async () => {
      // Even a digest that would verify is refused: the channel itself is not the signed one.
      assert.equal(await webhookStatus({
        method: 'POST',
        query: { id: dataId, topic: 'payment' },
        headers: { 'x-signature': signature, 'x-request-id': requestId },
        body: { type: 'payment', data: { id: dataId } },
      }), 401);
    });
    const logged = entries.map(([, value]) => value as Record<string, unknown>);
    assert.ok(logged.some((entry) => entry.code === 'webhook_rejected' && entry.reason === 'legacy_notification_rejected' && entry.resourceSource === 'id'));

    // A notification carrying both channels at once is ambiguous and also refused.
    assert.equal(await webhookStatus({
      method: 'POST',
      query: { 'data.id': dataId, id: dataId },
      headers: { 'x-signature': signature, 'x-request-id': requestId },
      body: { type: 'payment' },
    }), 401);
  });
});

test('webhook resolves exactly one unambiguous resource id and forwards it verbatim', () => {
  assert.deepEqual(webhookResource({ query: { 'data.id': '178628386843' } }), { resourceId: '178628386843', source: 'data.id', reason: null });
  assert.deepEqual(webhookResource({ query: { id: '178628386843' } }), { resourceId: '178628386843', source: 'id', reason: null });
  assert.equal(webhookResource({ query: { 'data.id': '1', id: '1' } }).reason, 'resource_id_ambiguous');
  assert.equal(webhookResource({ query: { 'data.id': ['1', '2'] } }).reason, 'resource_id_ambiguous');
  assert.equal(webhookResource({ query: { 'data.id': ['1', '1'] } }).reason, 'resource_id_ambiguous');
  assert.equal(webhookResource({ query: {} }).reason, 'resource_id_missing');
  assert.equal(webhookResource({ query: { 'data.id': ' 178628386843' } }).reason, 'resource_id_invalid');
  // No local normalization: the SDK validator owns the documented manifest rules.
  assert.equal(webhookResource({ query: { 'data.id': 'PAYMENTABC123' } }).resourceId, 'PAYMENTABC123');
});

test('webhook telemetry reports a sanitized SDK reason and never signature material', async () => {
  await withWebhookSecret(OFFICIAL_SECRET, async () => {
    const dataId = '178628386843';
    const requestId = 'req-telemetry';
    const signature = officialSignature(dataId, requestId, '1704908010', 'another-secret');
    const entries = await captureConsoleInfo(async () => {
      assert.equal(await webhookStatus({ method: 'POST', query: { 'data.id': dataId }, headers: { 'x-signature': signature, 'x-request-id': requestId }, body: { type: 'payment' } }), 401);
    });
    const logged = entries.map(([, value]) => value as Record<string, unknown>);
    const rejection = logged.find((entry) => entry.code === 'webhook_rejected');
    assert.ok(rejection);
    assert.equal(rejection?.reason, 'signature_invalid');
    assert.equal(rejection?.signatureFailureReason, 'SignatureMismatch');
    const serialized = JSON.stringify(logged);
    assert.equal(serialized.includes(OFFICIAL_SECRET), false);
    assert.equal(serialized.includes(digestOf(signature)), false);
  });
});

test('webhook lookup failure records the resource id and no sensitive material', async () => {
  const dataId = '178630749617';
  const requestId = 'req-lookup-404';
  const signature = officialSignature(dataId, requestId, '1704908010');
  const accessToken = 'synthetic-access-token-value';
  const serviceRoleKey = 'synthetic-service-role-key';
  const payerEmail = 'comprador@example.test';
  const originalFetch = globalThis.fetch;
  const before = {
    supabaseUrl: process.env.SUPABASE_URL,
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
    accessToken: process.env.MERCADOPAGO_ACCESS_TOKEN,
  };
  process.env.SUPABASE_URL = 'https://synthetic.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = serviceRoleKey;
  process.env.MERCADOPAGO_ACCESS_TOKEN = accessToken;
  let providerCalls = 0;
  globalThis.fetch = (async () => {
    providerCalls++;
    return { ok: false, status: 404, json: async () => ({}) };
  }) as never;

  try {
    await withWebhookSecret(OFFICIAL_SECRET, async () => {
      const entries = await captureConsoleInfo(async () => {
        assert.equal(await webhookStatus({
          method: 'POST',
          query: { 'data.id': dataId },
          headers: { 'x-signature': signature, 'x-request-id': requestId },
          body: { type: 'payment', data: { id: dataId }, payer: { email: payerEmail } },
        }), 502);
      });
      const logged = entries.map(([, value]) => value as Record<string, unknown>);
      const failure = logged.find((entry) => entry.code === 'webhook_payment_lookup_failed');
      assert.ok(failure, 'expected a webhook_payment_lookup_failed event');
      // The whole point of this event: it must say which data.id could not be resolved.
      assert.equal(failure?.resourceId, dataId);
      assert.equal(failure?.providerHttpStatus, 404);
      assert.equal(providerCalls, 1);

      // Nothing else may reach the log: no headers, signature, secret, token, body or PII.
      const serialized = JSON.stringify(logged);
      for (const forbidden of [OFFICIAL_SECRET, signature, digestOf(signature), requestId, accessToken, serviceRoleKey, payerEmail]) {
        assert.equal(serialized.includes(forbidden), false, `leaked sensitive value in telemetry`);
      }
      assert.deepEqual(Object.keys(failure ?? {}).sort(), ['code', 'providerHttpStatus', 'resourceId']);
    });
  } finally {
    globalThis.fetch = originalFetch;
    if (before.supabaseUrl === undefined) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = before.supabaseUrl;
    if (before.serviceRoleKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY; else process.env.SUPABASE_SERVICE_ROLE_KEY = before.serviceRoleKey;
    if (before.accessToken === undefined) delete process.env.MERCADOPAGO_ACCESS_TOKEN; else process.env.MERCADOPAGO_ACCESS_TOKEN = before.accessToken;
  }
});

test('one signed channel keeps a single payment from being processed twice', async () => {
  await withWebhookSecret(OFFICIAL_SECRET, async () => {
    const dataId = '178629538119';
    const requestId = 'req-single-channel';
    const signature = officialSignature(dataId, requestId, '1704908010');
    // The IPN copy of the very same event never reaches provider or persistence work.
    assert.equal(await webhookStatus({ method: 'POST', query: { id: dataId, topic: 'payment' }, headers: { 'x-signature': signature, 'x-request-id': requestId }, body: { type: 'payment', data: { id: dataId } } }), 401);
    // Only the signed data.id delivery is accepted, so the event is handled once.
    assert.equal(await webhookStatus({ method: 'POST', query: { 'data.id': dataId }, headers: { 'x-signature': signature, 'x-request-id': requestId }, body: { type: 'merchant_order', data: { id: dataId } } }), 200);
  });
});

test('new Checkout Pro preferences never carry a notification_url', () => {
  const body = buildPreferenceBody({
    orderId: reconcileOrderId,
    siteUrl: 'https://rehabex.example.test',
    items: [{ product_id: 'p-1', product_name: 'Producto', quantity: 2, unit_price: '150.5' }],
    reservationExpiresAt: '2026-01-01T00:15:00.000Z',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
  });
  assert.equal(Object.prototype.hasOwnProperty.call(body, 'notification_url'), false);
  assert.equal(JSON.stringify(body).includes('notification_url'), false);
  assert.equal(body.external_reference, reconcileOrderId);
  assert.deepEqual(body.items, [{ id: 'p-1', title: 'Producto', quantity: 2, unit_price: 150.5, currency_id: 'ARS' }]);
  assert.deepEqual(body.back_urls, { success: 'https://rehabex.example.test/success', failure: 'https://rehabex.example.test/failure', pending: 'https://rehabex.example.test/pending' });
  assert.equal(body.expiration_date_from, '2026-01-01T00:00:00.000Z');
  assert.equal(body.expiration_date_to, '2026-01-01T00:15:00.000Z');

  // The checkout path no longer resolves any notification URL at all.
  const before = process.env.PUBLIC_SITE_URL;
  process.env.PUBLIC_SITE_URL = 'https://rehabex.example.test';
  try { assert.deepEqual(Object.keys(backendUrls()), ['site']); } finally {
    if (before === undefined) delete process.env.PUBLIC_SITE_URL; else process.env.PUBLIC_SITE_URL = before;
  }
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

async function captureConsoleInfo(run: () => Promise<void>) {
  const original = console.info;
  const entries: unknown[][] = [];
  console.info = (...args: unknown[]) => { entries.push(args); };
  try {
    await run();
    return entries;
  } finally {
    console.info = original;
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

test('admin reconciliation emits sanitized stage telemetry and distinguishes every 503', async () => {
  await withAccessToken(async () => {
    const cases: Array<{
      name: string;
      overrides: Record<string, unknown>;
      stage: string;
      errorCode: string;
      providerHttpStatus?: number;
    }> = [
      {
        name: 'rate limit',
        overrides: { consumeRateLimit: async () => ({ ok: false, retryAfter: 0, unavailable: true }) },
        stage: 'rate_limit', errorCode: 'rate_limit_unavailable',
      },
      {
        name: 'payment fetch',
        overrides: { fetchPayment: async () => ({ kind: 'unavailable', stage: 'payment_fetch', errorCode: 'provider_payment_http_error', httpStatus: 502 }) },
        stage: 'payment_fetch', errorCode: 'provider_payment_http_error', providerHttpStatus: 502,
      },
      {
        name: 'payment parse',
        overrides: { fetchPayment: async () => ({ kind: 'unavailable', stage: 'payment_parse', errorCode: 'provider_payment_parse_error', httpStatus: 200 }) },
        stage: 'payment_parse', errorCode: 'provider_payment_parse_error', providerHttpStatus: 200,
      },
      {
        name: 'merchant order fetch',
        overrides: { fetchPayment: async () => ({ kind: 'unavailable', stage: 'merchant_order_fetch', errorCode: 'provider_merchant_order_http_error', httpStatus: 429 }) },
        stage: 'merchant_order_fetch', errorCode: 'provider_merchant_order_http_error', providerHttpStatus: 429,
      },
      {
        name: 'merchant order parse',
        overrides: { fetchPayment: async () => ({ kind: 'unavailable', stage: 'merchant_order_parse', errorCode: 'provider_merchant_order_parse_error', httpStatus: 200 }) },
        stage: 'merchant_order_parse', errorCode: 'provider_merchant_order_parse_error', providerHttpStatus: 200,
      },
      {
        name: 'atomic rpc',
        overrides: { processPayment: async () => ({ kind: 'unavailable' }) },
        stage: 'atomic_rpc', errorCode: 'atomic_rpc_unavailable',
      },
    ];

    for (const scenario of cases) {
      const result = mockResponse();
      const logs = await captureConsoleInfo(async () => {
        await reconcileHandler(scenario.overrides)({ method: 'POST', headers: reconcileHeaders(), body: { paymentId: '179368065874' } }, result.response);
      });
      assert.equal(result.read().statusCode, 503, scenario.name);
      assert.deepEqual(result.read().body, { error: 'No disponible.' }, scenario.name);
      assert.deepEqual(logs, [[
        '[commerce]',
        {
          code: 'admin_reconcile_503',
          stage: scenario.stage,
          errorCode: scenario.errorCode,
          ...(scenario.providerHttpStatus === undefined ? {} : { providerHttpStatus: scenario.providerHttpStatus }),
        },
      ]], scenario.name);
    }
  });
});

test('admin reconciliation telemetry sanitizes invalid internal codes', async () => {
  await withAccessToken(async () => {
    const result = mockResponse();
    const logs = await captureConsoleInfo(async () => {
      await reconcileHandler({
        fetchPayment: async () => ({
          kind: 'unavailable', stage: 'payment_fetch', errorCode: 'token=secret&url=https://api.mercadopago.com/v1/payments/123', httpStatus: 500,
        }),
      })({ method: 'POST', headers: reconcileHeaders(), body: { paymentId: '179368065874' } }, result.response);
    });
    assert.equal(result.read().statusCode, 503);
    assert.deepEqual(logs, [[
      '[commerce]',
      { code: 'admin_reconcile_503', stage: 'payment_fetch', errorCode: 'reconciliation_error', providerHttpStatus: 500 },
    ]]);
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

test('Checkout Pro payment DTO resolves a missing preference through its merchant order', async () => {
  const fixturePaymentId = '987654321012';
  const fixtureOrderId = '11111111-1111-4111-8111-111111111111';
  const fixtureMerchantOrderId = 40472643708;
  const requests: string[] = [];
  const result = await fetchMercadoPagoPayment(fixturePaymentId, 'synthetic-access-token', async (url) => {
    requests.push(url);
    if (url.includes('/v1/payments/')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          id: fixturePaymentId,
          status: 'approved',
          external_reference: fixtureOrderId,
          transaction_amount: 300,
          currency_id: 'ARS',
          live_mode: false,
          order: { id: fixtureMerchantOrderId },
          payment_method_id: 'account_money',
          additional_info: { items: [{ quantity: 3 }] },
        }),
      };
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({ preference_id: 'pref-checkout-pro' }),
    };
  });
  assert.deepEqual(requests, [
    `https://api.mercadopago.com/v1/payments/${fixturePaymentId}`,
    `https://api.mercadopago.com/merchant_orders/${fixtureMerchantOrderId}`,
  ]);
  assert.deepEqual(result, {
    kind: 'ok',
    payment: {
      id: fixturePaymentId, status: 'approved', external_reference: fixtureOrderId,
      transaction_amount: 300, currency_id: 'ARS', preference_id: 'pref-checkout-pro', live_mode: false,
    },
  });
});

test('Checkout Pro payment DTO preserves only official fields and rejects absent or invalid required fields', async () => {
  const fixtureOrderId = '11111111-1111-4111-8111-111111111111';
  const raw = {
    id: '987654321012',
    status: 'approved',
    external_reference: fixtureOrderId,
    transaction_amount: 100,
    currency_id: 'ARS',
    live_mode: false,
    order: { id: 40472643708 },
  };
  assert.deepEqual(adaptMercadoPagoPayment(raw, 'pref-checkout-pro'), {
    id: '987654321012', status: 'approved', external_reference: fixtureOrderId,
    transaction_amount: 100, currency_id: 'ARS', preference_id: 'pref-checkout-pro', live_mode: false,
  });

  for (const invalid of [
    { ...raw, status: undefined },
    { ...raw, external_reference: undefined },
    { ...raw, transaction_amount: undefined },
    { ...raw, currency_id: undefined },
    { ...raw, transaction_amount: Number.NaN },
    { ...raw, preference_id: undefined, order: undefined },
    { ...raw, preference_id: { invalid: true }, order: undefined },
  ]) {
    const { repository, calls } = paymentRepository();
    const result = await processMercadoPagoPayment(repository, adaptMercadoPagoPayment(invalid), { requestId: null });
    assert.deepEqual(result, { kind: 'rejected', reason: 'payment_shape_invalid' });
    assert.deepEqual(calls, { atomic: 0 });
  }
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
