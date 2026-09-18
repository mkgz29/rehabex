import assert from 'node:assert/strict';
import test from 'node:test';

import { createOrderPaymentSyncHandler, parseOrderPaymentSyncPayload } from '../../api/order-payment-sync';
import { confirmMercadoPagoPayment, selectOrderPayment, verifyPaymentMatchesOrder } from '../../server/commerce/paymentConfirmation.js';
import { fetchMercadoPagoPayment, searchMercadoPagoPaymentsByExternalReference } from '../../server/commerce/mercadoPagoPayment.js';
import type { ApiRequest, ApiResponse } from '../../server/commerce/commerce.js';
import type { MercadoPagoPayment } from '../../server/commerce/paymentProcessing.js';

const ORDER_ID = '159e3369-63a9-4879-b5ce-8f0db6369508';
const PREFERENCE_ID = '3369421914-4c34d4e1-a70c-43de-b3d7-a61310711276';
const STATUS_TOKEN = 'a'.repeat(43);
const ACCESS_TOKEN = 'synthetic-access-token-value';

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

function orderRow(overrides: Record<string, unknown> = {}) {
  return {
    id: ORDER_ID,
    order_number: 'RHB-202609-000013',
    payment_status: 'unpaid',
    order_status: 'pending_payment',
    fulfillment_status: 'not_started',
    total_amount: '100.00',
    currency: 'ARS',
    refund_required: false,
    created_at: '2026-09-18T04:12:10.658Z',
    mercadopago_preference_id: PREFERENCE_ID,
    ...overrides,
  };
}

function supabaseMock(options: { order?: Record<string, unknown> | null; atomic?: { outcome: string; duplicate?: boolean }; cooldown?: boolean } = {}) {
  const order = options.order === undefined ? orderRow() : options.order;
  const calls = { rpc: [] as string[], selects: [] as string[] };
  const client: any = {
    from() {
      const builder: any = {
        select(columns: string) { calls.selects.push(columns); return builder; },
        eq() { return builder; },
        async maybeSingle() { return { data: order, error: null }; },
      };
      return builder;
    },
    async rpc(name: string, _input: unknown) {
      calls.rpc.push(name);
      if (name === 'claim_payment_recovery_attempt') {
        return options.cooldown
          ? { data: [{ allowed: false, retry_after_seconds: 17 }], error: null }
          : { data: [{ allowed: true, retry_after_seconds: 0 }], error: null };
      }
      if (name === 'process_mercadopago_payment_atomic') {
        return {
          data: [{
            event_id: '11111111-1111-4111-8111-111111111111',
            outcome: options.atomic?.outcome ?? 'approved',
            is_duplicate: Boolean(options.atomic?.duplicate),
          }],
          error: null,
        };
      }
      return { data: null, error: null };
    },
  };
  return { client, calls };
}

function providerPayment(overrides: Partial<MercadoPagoPayment> = {}): MercadoPagoPayment {
  return {
    id: '178632439037',
    status: 'approved',
    transaction_amount: 100,
    currency_id: 'ARS',
    external_reference: ORDER_ID,
    live_mode: false,
    ...overrides,
  };
}

function syncRequest(body: unknown = { orderId: ORDER_ID }, token: string | null = STATUS_TOKEN): ApiRequest {
  const headers: Record<string, string> = { origin: 'http://localhost:5173', 'content-type': 'application/json' };
  if (token) headers['x-order-status-token'] = token;
  return { method: 'POST', headers, body: JSON.stringify(body) };
}

function handlerWith(overrides: Record<string, unknown> = {}, mock = supabaseMock()) {
  return createOrderPaymentSyncHandler({
    serviceClient: (() => mock.client) as never,
    consumeRateLimit: (async () => ({ ok: true, retryAfter: 0, unavailable: false })) as never,
    searchPayments: (async () => ({ kind: 'ok', payments: [providerPayment()] })) as never,
    fetchPayment: (async () => ({ kind: 'ok', payment: providerPayment(), preferenceBinding: 'unresolved' })) as never,
    ...overrides,
  } as never);
}

async function withAccessToken(run: () => Promise<void>) {
  const before = process.env.MERCADOPAGO_ACCESS_TOKEN;
  process.env.MERCADOPAGO_ACCESS_TOKEN = ACCESS_TOKEN;
  try { await run(); } finally {
    if (before === undefined) delete process.env.MERCADOPAGO_ACCESS_TOKEN; else process.env.MERCADOPAGO_ACCESS_TOKEN = before;
  }
}

async function captureConsoleInfo(run: () => Promise<void>) {
  const original = console.info;
  const entries: unknown[][] = [];
  console.info = (...args: unknown[]) => { entries.push(args); };
  try { await run(); return entries; } finally { console.info = original; }
}

// ---------------------------------------------------------------------------
// Payment selection
// ---------------------------------------------------------------------------

test('recovery accepts only a payment that matches the order on every authoritative field', () => {
  const order = { id: ORDER_ID, total_amount: '100.00', currency: 'ARS' };
  assert.equal(selectOrderPayment([providerPayment()], order).kind, 'selected');
  // Mismatched reference, amount, currency and production mode are all refused.
  assert.equal(selectOrderPayment([providerPayment({ external_reference: '00000000-0000-4000-8000-000000000000' })], order).kind, 'none');
  assert.equal(selectOrderPayment([providerPayment({ transaction_amount: 99.99 })], order).kind, 'none');
  assert.equal(selectOrderPayment([providerPayment({ currency_id: 'USD' })], order).kind, 'none');
  assert.equal(selectOrderPayment([providerPayment({ live_mode: true })], order).kind, 'none');
  assert.equal(selectOrderPayment([providerPayment({ status: 'unsupported_state' })], order).kind, 'none');
  assert.equal(selectOrderPayment([], order).kind, 'none');
});

test('recovery prefers the settled payment over an earlier failed attempt', () => {
  const order = { id: ORDER_ID, total_amount: 100, currency: 'ARS' };
  const selection = selectOrderPayment([
    providerPayment({ id: '1', status: 'rejected' }),
    providerPayment({ id: '2', status: 'approved' }),
    providerPayment({ id: '3', status: 'pending' }),
  ], order);
  assert.equal(selection.kind, 'selected');
  assert.equal(selection.kind === 'selected' ? selection.payment.id : null, '2');
});

test('recovery refuses to choose between two payments that both settled the order', () => {
  const order = { id: ORDER_ID, total_amount: 100, currency: 'ARS' };
  const selection = selectOrderPayment([
    providerPayment({ id: '1', status: 'approved' }),
    providerPayment({ id: '2', status: 'approved' }),
  ], order);
  assert.deepEqual(selection, { kind: 'ambiguous', candidates: 2 });
});

// ---------------------------------------------------------------------------
// Provider contract
// ---------------------------------------------------------------------------

test('a forbidden merchant order no longer fails the whole confirmation', async () => {
  // Observed in production: the access token is not authorized for
  // /merchant_orders, which used to turn every real notification into a 502.
  const responses: Record<string, { ok: boolean; status: number; body: unknown }> = {
    payment: { ok: true, status: 200, body: { id: '178632439037', status: 'approved', transaction_amount: 100, currency_id: 'ARS', external_reference: ORDER_ID, live_mode: false, order: { id: '44536002569' } } },
    merchant: { ok: false, status: 403, body: {} },
  };
  const result = await fetchMercadoPagoPayment('178632439037', ACCESS_TOKEN, (async (url: string) => {
    const entry = url.includes('/merchant_orders/') ? responses.merchant : responses.payment;
    return { ok: entry.ok, status: entry.status, json: async () => entry.body };
  }) as never);
  assert.equal(result.kind, 'ok');
  assert.equal(result.kind === 'ok' ? result.preferenceBinding : null, 'unresolved');
  assert.equal(result.kind === 'ok' ? result.payment.preference_id : 'set', undefined);
});

test('a readable merchant order still provides the strongest preference binding', async () => {
  const result = await fetchMercadoPagoPayment('178632439037', ACCESS_TOKEN, (async (url: string) => {
    if (url.includes('/merchant_orders/')) return { ok: true, status: 200, json: async () => ({ preference_id: PREFERENCE_ID }) };
    return { ok: true, status: 200, json: async () => ({ id: '178632439037', status: 'approved', transaction_amount: 100, currency_id: 'ARS', external_reference: ORDER_ID, live_mode: false, order: { id: '44536002569' } }) };
  }) as never);
  assert.equal(result.kind === 'ok' ? result.preferenceBinding : null, 'merchant_order');
  assert.equal(result.kind === 'ok' ? result.payment.preference_id : null, PREFERENCE_ID);
});

test('an absent payment is reported as not found, a provider outage as unavailable', async () => {
  const notFound = await fetchMercadoPagoPayment('999999999999999999', ACCESS_TOKEN, (async () => ({ ok: false, status: 404, json: async () => ({}) })) as never);
  assert.equal(notFound.kind, 'not_found');
  const down = await fetchMercadoPagoPayment('178632439037', ACCESS_TOKEN, (async () => ({ ok: false, status: 500, json: async () => ({}) })) as never);
  assert.equal(down.kind, 'unavailable');
});

test('payment search reads the documented envelope and drops unusable rows', async () => {
  const ok = await searchMercadoPagoPaymentsByExternalReference(ORDER_ID, ACCESS_TOKEN, (async (url: string) => {
    assert.ok(url.includes(`external_reference=${ORDER_ID}`));
    return {
      ok: true,
      status: 200,
      json: async () => ({
        paging: { total: 3, limit: 30, offset: 0 },
        results: [
          { id: '178632439037', status: 'approved', transaction_amount: 100, currency_id: 'ARS', external_reference: ORDER_ID, live_mode: false },
          { id: '178632439038', status: 'rejected', transaction_amount: 100, currency_id: 'ARS', external_reference: ORDER_ID, live_mode: false },
          { status: 'approved' },
        ],
      }),
    };
  }) as never);
  assert.equal(ok.kind, 'ok');
  assert.equal(ok.kind === 'ok' ? ok.payments.length : 0, 2);

  const broken = await searchMercadoPagoPaymentsByExternalReference(ORDER_ID, ACCESS_TOKEN, (async () => ({ ok: true, status: 200, json: async () => ({}) })) as never);
  assert.equal(broken.kind, 'unavailable');
  const failed = await searchMercadoPagoPaymentsByExternalReference(ORDER_ID, ACCESS_TOKEN, (async () => ({ ok: false, status: 503, json: async () => ({}) })) as never);
  assert.equal(failed.kind === 'unavailable' ? failed.httpStatus : null, 503);
});

// ---------------------------------------------------------------------------
// Shared confirmation
// ---------------------------------------------------------------------------

test('confirmation derives the preference from the order only when the provider omits it', async () => {
  const withProvider = supabaseMock();
  const provided = await confirmMercadoPagoPayment(withProvider.client, providerPayment({ preference_id: PREFERENCE_ID }), { requestId: null, binding: 'payment' });
  assert.equal(provided.binding, 'payment');
  assert.equal(provided.result.kind, 'processed');

  const withoutProvider = supabaseMock();
  const derived = await confirmMercadoPagoPayment(withoutProvider.client, providerPayment(), { requestId: null, binding: 'unresolved' });
  assert.equal(derived.binding, 'order_external_reference');
  assert.equal(derived.result.kind, 'processed');
  assert.ok(withoutProvider.calls.rpc.includes('process_mercadopago_payment_atomic'));
});

test('confirmation reaches the same atomic RPC and reports its duplicate verdict', async () => {
  const duplicate = supabaseMock({ atomic: { outcome: 'duplicate', duplicate: true } });
  const result = await confirmMercadoPagoPayment(duplicate.client, providerPayment(), { requestId: null, binding: 'unresolved' });
  assert.equal(result.result.kind, 'duplicate');
  assert.equal(duplicate.calls.rpc.filter((name) => name === 'process_mercadopago_payment_atomic').length, 1);
});

// ---------------------------------------------------------------------------
// Recovery endpoint
// ---------------------------------------------------------------------------

test('recovery accepts exactly one field and nothing about the payment itself', () => {
  assert.equal(parseOrderPaymentSyncPayload({ orderId: ORDER_ID }), ORDER_ID);
  assert.equal(parseOrderPaymentSyncPayload({ orderId: ORDER_ID, status: 'approved' }), null);
  assert.equal(parseOrderPaymentSyncPayload({ orderId: ORDER_ID, paymentId: '1' }), null);
  assert.equal(parseOrderPaymentSyncPayload({ orderId: ORDER_ID, amount: 1 }), null);
  assert.equal(parseOrderPaymentSyncPayload({ orderId: 'not-a-uuid' }), null);
  assert.equal(parseOrderPaymentSyncPayload({}), null);
});

test('recovery refuses a request without a valid guest token before any provider work', async () => {
  await withAccessToken(async () => {
    let searched = false;
    const handler = handlerWith({ searchPayments: async () => { searched = true; return { kind: 'ok', payments: [] }; } });
    const missing = mockResponse();
    await handler(syncRequest({ orderId: ORDER_ID }, null), missing.response);
    assert.equal(missing.read().statusCode, 404);
    const malformed = mockResponse();
    await handler(syncRequest({ orderId: ORDER_ID }, 'short-token'), malformed.response);
    assert.equal(malformed.read().statusCode, 404);
    assert.equal(searched, false);
  });
});

test('recovery answers 404 for an order the token does not own', async () => {
  await withAccessToken(async () => {
    let searched = false;
    const mock = supabaseMock({ order: null });
    const handler = handlerWith({ searchPayments: async () => { searched = true; return { kind: 'ok', payments: [] }; } }, mock);
    const result = mockResponse();
    await handler(syncRequest(), result.response);
    assert.equal(result.read().statusCode, 404);
    assert.equal(searched, false);
  });
});

test('recovery honours the request rate limit before touching Mercado Pago', async () => {
  await withAccessToken(async () => {
    let searched = false;
    const handler = handlerWith({
      consumeRateLimit: (async () => ({ ok: false, retryAfter: 42, unavailable: false })) as never,
      searchPayments: async () => { searched = true; return { kind: 'ok', payments: [] }; },
    });
    const result = mockResponse();
    await handler(syncRequest(), result.response);
    assert.equal(result.read().statusCode, 429);
    assert.equal(result.read().headers.get('Retry-After'), '42');
    assert.equal(searched, false);
  });
});

test('recovery never queries the provider for an order that already settled', async () => {
  await withAccessToken(async () => {
    let searched = false;
    const mock = supabaseMock({ order: orderRow({ payment_status: 'approved', order_status: 'confirmed' }) });
    const handler = handlerWith({ searchPayments: async () => { searched = true; return { kind: 'ok', payments: [] }; } }, mock);
    const result = mockResponse();
    await handler(syncRequest(), result.response);
    assert.equal(result.read().statusCode, 200);
    assert.equal(result.read().body.recovery, 'already_settled');
    assert.equal(searched, false);
  });
});

test('recovery applies a per-order cooldown so polling cannot hammer the provider', async () => {
  await withAccessToken(async () => {
    let searched = false;
    const mock = supabaseMock({ cooldown: true });
    const handler = handlerWith({ searchPayments: async () => { searched = true; return { kind: 'ok', payments: [] }; } }, mock);
    const result = mockResponse();
    await handler(syncRequest(), result.response);
    assert.equal(result.read().body.recovery, 'cooldown');
    assert.equal(result.read().headers.get('Retry-After'), '17');
    assert.equal(searched, false);
  });
});

test('recovery confirms a lost webhook through the atomic processor exactly once', async () => {
  await withAccessToken(async () => {
    const mock = supabaseMock();
    const handler = handlerWith({}, mock);
    const result = mockResponse();
    await handler(syncRequest(), result.response);
    assert.equal(result.read().statusCode, 200);
    assert.equal(result.read().body.recovery, 'confirmed');
    assert.equal(mock.calls.rpc.filter((name) => name === 'process_mercadopago_payment_atomic').length, 1);
  });
});

test('recovery reports a replayed confirmation as duplicate without a second transition', async () => {
  await withAccessToken(async () => {
    const mock = supabaseMock({ atomic: { outcome: 'duplicate', duplicate: true } });
    const handler = handlerWith({}, mock);
    const result = mockResponse();
    await handler(syncRequest(), result.response);
    assert.equal(result.read().body.recovery, 'duplicate');
    assert.equal(mock.calls.rpc.filter((name) => name === 'process_mercadopago_payment_atomic').length, 1);
  });
});

test('recovery reports an absent payment without inventing a state', async () => {
  await withAccessToken(async () => {
    const mock = supabaseMock();
    const handler = handlerWith({ searchPayments: (async () => ({ kind: 'ok', payments: [] })) as never }, mock);
    const result = mockResponse();
    await handler(syncRequest(), result.response);
    assert.equal(result.read().body.recovery, 'no_payment_found');
    assert.equal(mock.calls.rpc.includes('process_mercadopago_payment_atomic'), false);
  });
});

test('recovery escalates a double charge instead of picking one payment', async () => {
  await withAccessToken(async () => {
    const mock = supabaseMock();
    const handler = handlerWith({
      searchPayments: (async () => ({ kind: 'ok', payments: [providerPayment({ id: '1' }), providerPayment({ id: '2' })] })) as never,
    }, mock);
    const result = mockResponse();
    await handler(syncRequest(), result.response);
    assert.equal(result.read().body.recovery, 'ambiguous_payments');
    assert.equal(mock.calls.rpc.includes('process_mercadopago_payment_atomic'), false);
  });
});

test('recovery degrades safely when the provider is unreachable', async () => {
  await withAccessToken(async () => {
    const mock = supabaseMock();
    const handler = handlerWith({
      searchPayments: (async () => ({ kind: 'unavailable', stage: 'payment_search', errorCode: 'provider_payment_search_http_error', httpStatus: 503 })) as never,
    }, mock);
    const result = mockResponse();
    await handler(syncRequest(), result.response);
    assert.equal(result.read().statusCode, 200);
    assert.equal(result.read().body.recovery, 'provider_unavailable');
    assert.equal(mock.calls.rpc.includes('process_mercadopago_payment_atomic'), false);
  });
});

test('recovery answers with the persisted order and never with provider fields', async () => {
  await withAccessToken(async () => {
    const mock = supabaseMock();
    const handler = handlerWith({}, mock);
    const result = mockResponse();
    await handler(syncRequest(), result.response);
    const order = result.read().body.order as Record<string, unknown>;
    // The public projection must not leak authentication material or the
    // preference, and must not echo anything the provider returned.
    for (const forbidden of ['status_access_token_hash', 'mercadopago_preference_lease_token', 'idempotency_key', 'customer_phone', 'delivery_address_line1']) {
      assert.equal(Object.prototype.hasOwnProperty.call(order, forbidden), false, `leaked ${forbidden}`);
    }
    const publicSelect = mock.calls.selects.find((columns) => !columns.includes('mercadopago_preference_id'));
    assert.ok(publicSelect, 'expected a public projection without the preference');
  });
});

test('recovery telemetry carries no token, order contents or buyer data', async () => {
  await withAccessToken(async () => {
    const mock = supabaseMock();
    const handler = handlerWith({
      searchPayments: (async () => ({ kind: 'unavailable', stage: 'payment_search', errorCode: 'provider_payment_search_http_error', httpStatus: 403 })) as never,
    }, mock);
    const entries = await captureConsoleInfo(async () => {
      const result = mockResponse();
      await handler(syncRequest(), result.response);
    });
    const logged = entries.map(([, value]) => value as Record<string, unknown>);
    const failure = logged.find((entry) => entry.code === 'payment_sync_failed');
    assert.ok(failure);
    assert.equal(failure?.providerHttpStatus, 403);
    assert.equal(failure?.stage, 'payment_search');
    const serialized = JSON.stringify(logged);
    for (const forbidden of [STATUS_TOKEN, ACCESS_TOKEN, PREFERENCE_ID, 'RHB-202609-000013']) {
      assert.equal(serialized.includes(forbidden), false, 'leaked sensitive value in telemetry');
    }
  });
});

// ---------------------------------------------------------------------------
// Real search-envelope shape
// ---------------------------------------------------------------------------

test('a search summary that omits the optional money fields still selects the payment', () => {
  // PaymentSearchResult declares live_mode, currency_id and transaction_amount
  // as optional. Requiring them at selection time discarded every real
  // candidate and reported "no payment found" for payments that existed.
  const order = { id: ORDER_ID, total_amount: '100.00', currency: 'ARS' };
  const summaryOnly: MercadoPagoPayment = { id: '179618368506', status: 'approved', external_reference: ORDER_ID };
  const selection = selectOrderPayment([summaryOnly], order);
  assert.equal(selection.kind, 'selected');
  assert.equal(selection.kind === 'selected' ? selection.payment.id : null, '179618368506');

  // A partially populated summary is accepted on the fields it does carry.
  const partial: MercadoPagoPayment = { id: '179618368506', status: 'approved', external_reference: ORDER_ID, currency_id: 'ARS' };
  assert.equal(selectOrderPayment([partial], order).kind, 'selected');
});

test('a search summary whose present fields disagree is still refused', () => {
  const order = { id: ORDER_ID, total_amount: '100.00', currency: 'ARS' };
  assert.equal(selectOrderPayment([{ id: '1', status: 'approved', external_reference: ORDER_ID, live_mode: true }], order).kind, 'none');
  assert.equal(selectOrderPayment([{ id: '1', status: 'approved', external_reference: ORDER_ID, currency_id: 'USD' }], order).kind, 'none');
  assert.equal(selectOrderPayment([{ id: '1', status: 'approved', external_reference: ORDER_ID, transaction_amount: 99 }], order).kind, 'none');
  assert.equal(selectOrderPayment([{ id: '1', status: 'approved', external_reference: '00000000-0000-4000-8000-000000000000' }], order).kind, 'none');
});

test('the full payment is the authority for TEST mode, currency and amount', () => {
  const order = { id: ORDER_ID, total_amount: '100.00', currency: 'ARS' };
  assert.equal(verifyPaymentMatchesOrder(providerPayment(), order), null);
  assert.equal(verifyPaymentMatchesOrder(providerPayment({ live_mode: true }), order), 'live_mode');
  assert.equal(verifyPaymentMatchesOrder(providerPayment({ currency_id: 'USD' }), order), 'currency');
  assert.equal(verifyPaymentMatchesOrder(providerPayment({ transaction_amount: 99.99 }), order), 'amount');
  assert.equal(verifyPaymentMatchesOrder(providerPayment({ external_reference: '00000000-0000-4000-8000-000000000000' }), order), 'external_reference');
  // A summary that never carried live_mode must not be treated as TEST by default.
  assert.equal(verifyPaymentMatchesOrder({ id: '1', status: 'approved', external_reference: ORDER_ID, currency_id: 'ARS', transaction_amount: 100 }, order), 'live_mode');
});

test('recovery refuses a payment that the full lookup contradicts, before the atomic RPC', async () => {
  await withAccessToken(async () => {
    const mock = supabaseMock();
    const handler = handlerWith({
      searchPayments: (async () => ({ kind: 'ok', payments: [{ id: '179618368506', status: 'approved', external_reference: ORDER_ID }] })) as never,
      fetchPayment: (async () => ({ kind: 'ok', payment: providerPayment({ live_mode: true }), preferenceBinding: 'unresolved' })) as never,
    }, mock);
    const entries = await captureConsoleInfo(async () => {
      const result = mockResponse();
      await handler(syncRequest(), result.response);
      assert.equal(result.read().body.recovery, 'payment_mismatch');
    });
    assert.equal(mock.calls.rpc.includes('process_mercadopago_payment_atomic'), false);
    const logged = entries.map(([, value]) => value as Record<string, unknown>);
    const mismatch = logged.find((entry) => entry.code === 'payment_sync_mismatch');
    assert.ok(mismatch);
    assert.equal(mismatch?.reason, 'live_mode');
  });
});

test('an empty search and a filtered-out search are distinguishable in telemetry', async () => {
  await withAccessToken(async () => {
    const empty = await captureConsoleInfo(async () => {
      const handler = handlerWith({ searchPayments: (async () => ({ kind: 'ok', payments: [] })) as never }, supabaseMock());
      const result = mockResponse();
      await handler(syncRequest(), result.response);
      assert.equal(result.read().body.recovery, 'no_payment_found');
    });
    const emptyEvent = empty.map(([, v]) => v as Record<string, unknown>).find((e) => e.code === 'payment_sync_no_match');
    assert.equal(emptyEvent?.searchResults, 0);

    const filtered = await captureConsoleInfo(async () => {
      const handler = handlerWith({
        searchPayments: (async () => ({
          kind: 'ok',
          payments: [{ id: '179618368506', status: 'approved', external_reference: 'otra-referencia', live_mode: true, currency_id: 'USD', transaction_amount: 7 }],
        })) as never,
      }, supabaseMock());
      const result = mockResponse();
      await handler(syncRequest(), result.response);
      assert.equal(result.read().body.recovery, 'no_payment_found');
    });
    const events = filtered.map(([, v]) => v as Record<string, unknown>);
    assert.equal(events.find((e) => e.code === 'payment_sync_no_match')?.searchResults, 1);
    const candidate = events.find((e) => e.code === 'payment_sync_candidate');
    assert.ok(candidate, 'expected a sanitized candidate line');
    assert.deepEqual(
      { resourceId: candidate?.resourceId, status: candidate?.status, liveMode: candidate?.liveMode, currency: candidate?.currency, amount: candidate?.amount, referenceMatches: candidate?.referenceMatches },
      { resourceId: '179618368506', status: 'approved', liveMode: true, currency: 'USD', amount: 7, referenceMatches: false },
    );
    // Only provider identifiers and money shape. Never payer data or a token.
    assert.deepEqual(Object.keys(candidate ?? {}).sort(), ['amount', 'code', 'currency', 'liveMode', 'orderId', 'referenceMatches', 'resourceId', 'status']);
  });
});
