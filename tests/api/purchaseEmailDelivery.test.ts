import assert from 'node:assert/strict';
import test from 'node:test';

import { confirmMercadoPagoPayment } from '../../server/commerce/paymentConfirmation.js';
import { deliverPurchaseConfirmationEmail, shouldSendPurchaseConfirmation } from '../../server/commerce/purchaseEmailDelivery.js';
import type { MercadoPagoPayment, PaymentProcessResult } from '../../server/commerce/paymentProcessing.js';

const ORDER_ID = '159e3369-63a9-4879-b5ce-8f0db6369508';
const ORIGINAL_ENV = { ...process.env };

function resetEnv() {
  for (const key of Object.keys(process.env)) {
    if (!(key in ORIGINAL_ENV)) delete process.env[key];
  }
  Object.assign(process.env, ORIGINAL_ENV);
}

function setValidEmailEnv() {
  process.env.EMAIL_PROVIDER_API_KEY = 'secret-key';
  process.env.EMAIL_FROM = 'Rehabex <compras@rehabex.example>';
  process.env.PUBLIC_SITE_URL = 'https://rehabex.example';
  delete process.env.EMAIL_REPLY_TO;
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

async function withFetch<T>(mock: typeof fetch, run: () => Promise<T>): Promise<T> {
  const original = globalThis.fetch;
  globalThis.fetch = mock;
  try {
    return await run();
  } finally {
    globalThis.fetch = original;
  }
}

function orderSnapshotRow(overrides: Record<string, unknown> = {}) {
  return {
    order_number: 'RHB-202610-000013',
    customer_name: 'Ana Pérez',
    customer_email: 'ana@example.test',
    subtotal_amount: 10000,
    shipping_amount: 0,
    discount_amount: 0,
    total_amount: 10000,
    delivery_method: 'pickup',
    delivery_recipient_name: null,
    delivery_address_line1: null,
    delivery_address_line2: null,
    delivery_city: null,
    delivery_province: null,
    delivery_postal_code: null,
    delivery_notes: null,
    pickup_location_label: 'Sucursal Centro',
    pickup_window: null,
    payment_status: 'approved',
    order_status: 'confirmed',
    ...overrides,
  };
}

const ITEM_ROWS = [{ product_name: 'Rodillera', product_sku: 'ROD-01', unit_price: 10000, quantity: 1, line_total: 10000 }];

/** Minimal supabase-js-shaped mock: .rpc() dispatches by name, .from() builds a query matching this module's exact call shape. */
function supabaseMock(options: { claim?: string; orderRow?: Record<string, unknown> | null; itemRows?: unknown[] | null; trackingTokenUpdateFails?: boolean } = {}) {
  const calls: { rpc: Array<{ name: string; input: unknown }>; trackingTokenUpdates: unknown[] } = { rpc: [], trackingTokenUpdates: [] };
  const orderRow = options.orderRow === undefined ? orderSnapshotRow() : options.orderRow;
  const itemRows = options.itemRows === undefined ? ITEM_ROWS : options.itemRows;

  const client = {
    from(table: string) {
      if (table === 'orders') {
        return {
          select() {
            return {
              eq() {
                return { maybeSingle: async () => ({ data: orderRow, error: null }) };
              },
            };
          },
          update(values: unknown) {
            calls.trackingTokenUpdates.push(values);
            return { eq: async () => ({ error: options.trackingTokenUpdateFails ? new Error('update failed') : null }) };
          },
        };
      }
      if (table === 'order_items') {
        return {
          select() {
            return {
              eq() {
                return { order: async () => ({ data: itemRows, error: null }) };
              },
            };
          },
        };
      }
      throw new Error(`unexpected table in test mock: ${table}`);
    },
    async rpc(name: string, input: unknown) {
      calls.rpc.push({ name, input });
      if (name === 'claim_order_email_delivery') {
        return { data: [{ claim: options.claim ?? 'claimed', event_id: '11111111-1111-4111-8111-111111111111' }], error: null };
      }
      if (name === 'mark_order_email_sent' || name === 'mark_order_email_failed') {
        return { data: null, error: null };
      }
      return { data: null, error: null };
    },
  };
  return { client, calls };
}

// --- shouldSendPurchaseConfirmation (pure predicate) --------------------------

test('shouldSendPurchaseConfirmation: true only for processed + status approved + transition approved', () => {
  const approved: PaymentProcessResult = { kind: 'processed', status: 'approved', transition: 'approved' };
  assert.equal(shouldSendPurchaseConfirmation(approved), true);
});

test('shouldSendPurchaseConfirmation: false for review_refund_required (late stock shortage), even though status is approved', () => {
  const result: PaymentProcessResult = { kind: 'processed', status: 'approved', transition: 'review_refund_required' };
  assert.equal(shouldSendPurchaseConfirmation(result), false);
});

test('shouldSendPurchaseConfirmation: false for pending/in_process', () => {
  assert.equal(shouldSendPurchaseConfirmation({ kind: 'processed', status: 'pending', transition: 'pending' }), false);
  assert.equal(shouldSendPurchaseConfirmation({ kind: 'processed', status: 'in_process', transition: 'in_process' }), false);
});

test('shouldSendPurchaseConfirmation: false for rejected/cancelled/refunded/charged_back', () => {
  assert.equal(shouldSendPurchaseConfirmation({ kind: 'processed', status: 'rejected', transition: 'rejected' }), false);
  assert.equal(shouldSendPurchaseConfirmation({ kind: 'processed', status: 'cancelled', transition: 'cancelled' }), false);
  assert.equal(shouldSendPurchaseConfirmation({ kind: 'processed', status: 'refunded', transition: 'refunded' }), false);
  assert.equal(shouldSendPurchaseConfirmation({ kind: 'processed', status: 'charged_back', transition: 'charged_back' }), false);
});

test('shouldSendPurchaseConfirmation: false for duplicate, rejected-by-shape, and unavailable', () => {
  assert.equal(shouldSendPurchaseConfirmation({ kind: 'duplicate', status: 'approved' }), false);
  assert.equal(shouldSendPurchaseConfirmation({ kind: 'rejected', reason: 'amount_mismatch' }), false);
  assert.equal(shouldSendPurchaseConfirmation({ kind: 'unavailable' }), false);
});

// --- deliverPurchaseConfirmationEmail (wiring) --------------------------------

test('deliverPurchaseConfirmationEmail: claimed + valid snapshot + provider success -> mark_order_email_sent with the provider id', async () => {
  setValidEmailEnv();
  const mock = supabaseMock({ claim: 'claimed' });
  await withFetch(
    (async () => jsonResponse(200, { id: 'resend-msg-42' })) as typeof fetch,
    () => deliverPurchaseConfirmationEmail(mock.client, ORDER_ID),
  );
  const markCall = mock.calls.rpc.find((c) => c.name === 'mark_order_email_sent');
  assert.ok(markCall, 'mark_order_email_sent was not called');
  assert.deepEqual(markCall!.input, { p_order_id: ORDER_ID, p_email_type: 'purchase_confirmation', p_provider_message_id: 'resend-msg-42' });
  assert.equal(mock.calls.rpc.some((c) => c.name === 'mark_order_email_failed'), false);
  resetEnv();
});

test('deliverPurchaseConfirmationEmail: mints a tracking token, persists its hash, and includes a "Ver mi pedido" link built from it', async () => {
  setValidEmailEnv();
  const mock = supabaseMock({ claim: 'claimed' });
  let capturedBody: any = null;
  await withFetch(
    (async (_url: string, init?: RequestInit) => { capturedBody = JSON.parse(String(init?.body)); return jsonResponse(200, { id: 'resend-msg-1' }); }) as typeof fetch,
    () => deliverPurchaseConfirmationEmail(mock.client, ORDER_ID),
  );
  assert.equal(mock.calls.trackingTokenUpdates.length, 1);
  const update = mock.calls.trackingTokenUpdates[0] as { tracking_token_hash?: unknown };
  assert.equal(typeof update.tracking_token_hash, 'string');
  assert.ok((update.tracking_token_hash as string).length > 0);
  assert.match(capturedBody.html, new RegExp(`https://rehabex\\.example/mi-pedido#${ORDER_ID}\\.`));
  assert.match(capturedBody.text, new RegExp(`https://rehabex\\.example/mi-pedido#${ORDER_ID}\\.`));
  resetEnv();
});

test('deliverPurchaseConfirmationEmail: a failed tracking-token persistence marks the email failed, never calls the provider', async () => {
  setValidEmailEnv();
  const mock = supabaseMock({ claim: 'claimed', trackingTokenUpdateFails: true });
  let fetchCalled = false;
  await withFetch(
    (async () => { fetchCalled = true; return jsonResponse(200, { id: 'x' }); }) as typeof fetch,
    () => deliverPurchaseConfirmationEmail(mock.client, ORDER_ID),
  );
  assert.equal(fetchCalled, false);
  const markCall = mock.calls.rpc.find((c) => c.name === 'mark_order_email_failed');
  assert.deepEqual(markCall!.input, { p_order_id: ORDER_ID, p_email_type: 'purchase_confirmation', p_error_code: 'tracking_token_unavailable' });
  resetEnv();
});

test('deliverPurchaseConfirmationEmail: already_sent -> provider never called, no mark_* call', async () => {
  setValidEmailEnv();
  const mock = supabaseMock({ claim: 'already_sent' });
  let fetchCalled = false;
  await withFetch(
    (async () => { fetchCalled = true; return jsonResponse(200, { id: 'x' }); }) as typeof fetch,
    () => deliverPurchaseConfirmationEmail(mock.client, ORDER_ID),
  );
  assert.equal(fetchCalled, false);
  assert.equal(mock.calls.rpc.some((c) => c.name === 'mark_order_email_sent' || c.name === 'mark_order_email_failed'), false);
  resetEnv();
});

test('deliverPurchaseConfirmationEmail: already_processing -> provider never called, no mark_* call', async () => {
  setValidEmailEnv();
  const mock = supabaseMock({ claim: 'already_processing' });
  let fetchCalled = false;
  await withFetch(
    (async () => { fetchCalled = true; return jsonResponse(200, { id: 'x' }); }) as typeof fetch,
    () => deliverPurchaseConfirmationEmail(mock.client, ORDER_ID),
  );
  assert.equal(fetchCalled, false);
  assert.equal(mock.calls.rpc.some((c) => c.name === 'mark_order_email_sent' || c.name === 'mark_order_email_failed'), false);
  resetEnv();
});

test('deliverPurchaseConfirmationEmail: a claim RPC error -> provider never called, no mark_* call', async () => {
  setValidEmailEnv();
  const mock = {
    from: supabaseMock().client.from,
    async rpc(name: string) {
      if (name === 'claim_order_email_delivery') return { data: null, error: new Error('boom') };
      return { data: null, error: null };
    },
  };
  let fetchCalled = false;
  await withFetch(
    (async () => { fetchCalled = true; return jsonResponse(200, { id: 'x' }); }) as typeof fetch,
    () => deliverPurchaseConfirmationEmail(mock as any, ORDER_ID),
  );
  assert.equal(fetchCalled, false);
});

test('deliverPurchaseConfirmationEmail: provider failure -> mark_order_email_failed with the mapped error_code, function resolves normally (never throws)', async () => {
  setValidEmailEnv();
  const mock = supabaseMock({ claim: 'claimed' });
  await withFetch(
    (async () => jsonResponse(503, { message: 'down' })) as typeof fetch,
    () => deliverPurchaseConfirmationEmail(mock.client, ORDER_ID),
  );
  const markCall = mock.calls.rpc.find((c) => c.name === 'mark_order_email_failed');
  assert.ok(markCall, 'mark_order_email_failed was not called');
  assert.deepEqual(markCall!.input, { p_order_id: ORDER_ID, p_email_type: 'purchase_confirmation', p_error_code: 'provider_unavailable' });
  resetEnv();
});

test('deliverPurchaseConfirmationEmail: missing provider config -> mark_order_email_failed(configuration_missing), provider never called', async () => {
  delete process.env.EMAIL_PROVIDER_API_KEY;
  delete process.env.EMAIL_FROM;
  process.env.PUBLIC_SITE_URL = 'https://rehabex.example';
  const mock = supabaseMock({ claim: 'claimed' });
  let fetchCalled = false;
  await withFetch(
    (async () => { fetchCalled = true; return jsonResponse(200, { id: 'x' }); }) as typeof fetch,
    () => deliverPurchaseConfirmationEmail(mock.client, ORDER_ID),
  );
  assert.equal(fetchCalled, false);
  const markCall = mock.calls.rpc.find((c) => c.name === 'mark_order_email_failed');
  assert.deepEqual(markCall!.input, { p_order_id: ORDER_ID, p_email_type: 'purchase_confirmation', p_error_code: 'configuration_missing' });
  resetEnv();
});

test('deliverPurchaseConfirmationEmail: order row not yet approved/confirmed (defense in depth) -> failed with order_not_confirmed, provider never called', async () => {
  setValidEmailEnv();
  const mock = supabaseMock({ claim: 'claimed', orderRow: orderSnapshotRow({ payment_status: 'pending', order_status: 'pending_payment' }) });
  let fetchCalled = false;
  await withFetch(
    (async () => { fetchCalled = true; return jsonResponse(200, { id: 'x' }); }) as typeof fetch,
    () => deliverPurchaseConfirmationEmail(mock.client, ORDER_ID),
  );
  assert.equal(fetchCalled, false);
  const markCall = mock.calls.rpc.find((c) => c.name === 'mark_order_email_failed');
  assert.deepEqual(markCall!.input, { p_order_id: ORDER_ID, p_email_type: 'purchase_confirmation', p_error_code: 'order_not_confirmed' });
  resetEnv();
});

test('deliverPurchaseConfirmationEmail: an unloadable order row -> failed with snapshot_unavailable, provider never called', async () => {
  setValidEmailEnv();
  const mock = supabaseMock({ claim: 'claimed', orderRow: null });
  let fetchCalled = false;
  await withFetch(
    (async () => { fetchCalled = true; return jsonResponse(200, { id: 'x' }); }) as typeof fetch,
    () => deliverPurchaseConfirmationEmail(mock.client, ORDER_ID),
  );
  assert.equal(fetchCalled, false);
  const markCall = mock.calls.rpc.find((c) => c.name === 'mark_order_email_failed');
  assert.deepEqual(markCall!.input, { p_order_id: ORDER_ID, p_email_type: 'purchase_confirmation', p_error_code: 'snapshot_unavailable' });
  resetEnv();
});

test('deliverPurchaseConfirmationEmail: never throws, even when the supabase client itself throws', async () => {
  const throwingClient = {
    from() { throw new Error('connection reset'); },
    async rpc(name: string) {
      if (name === 'claim_order_email_delivery') return { data: [{ claim: 'claimed' }], error: null };
      return { data: null, error: null };
    },
  };
  await assert.doesNotReject(() => deliverPurchaseConfirmationEmail(throwingClient as any, ORDER_ID));
});

// --- wiring through confirmMercadoPagoPayment (FASE 7E-B2, section 7-9) -----

function providerPayment(overrides: Partial<MercadoPagoPayment> = {}): MercadoPagoPayment {
  return { id: '178632439037', status: 'approved', transaction_amount: 100, currency_id: 'ARS', external_reference: ORDER_ID, live_mode: false, ...overrides };
}

function confirmationSupabaseMock(options: { atomicOutcome: string; isDuplicate?: boolean; claimThrows?: boolean }) {
  const calls: string[] = [];
  const orderRow = { mercadopago_preference_id: 'pref-1' };
  const client = {
    from(table: string) {
      if (table === 'orders') {
        return {
          select() {
            return {
              eq() {
                return {
                  eq() { return { maybeSingle: async () => ({ data: orderRow, error: null }) }; },
                  maybeSingle: async () => ({ data: orderSnapshotRow(), error: null }),
                };
              },
            };
          },
        };
      }
      if (table === 'order_items') {
        return { select() { return { eq() { return { order: async () => ({ data: ITEM_ROWS, error: null }) }; } }; } };
      }
      throw new Error(`unexpected table: ${table}`);
    },
    async rpc(name: string, input: unknown) {
      calls.push(name);
      if (name === 'process_mercadopago_payment_atomic') {
        return { data: [{ event_id: '1', outcome: options.atomicOutcome, is_duplicate: Boolean(options.isDuplicate) }], error: null };
      }
      if (name === 'claim_order_email_delivery') {
        if (options.claimThrows) throw new Error('db connection lost');
        return { data: [{ claim: 'claimed' }], error: null };
      }
      return { data: null, error: null };
    },
  };
  return { client, calls };
}

test('confirmMercadoPagoPayment: an approved + confirmed outcome attempts the email claim', async () => {
  setValidEmailEnv();
  const mock = confirmationSupabaseMock({ atomicOutcome: 'approved' });
  await withFetch((async () => jsonResponse(200, { id: 'x' })) as typeof fetch, () =>
    confirmMercadoPagoPayment(mock.client, providerPayment(), { requestId: null, binding: 'unresolved' }),
  );
  assert.ok(mock.calls.includes('claim_order_email_delivery'));
  resetEnv();
});

test('confirmMercadoPagoPayment: pending/rejected/duplicate/review_refund_required never attempt the email claim', async () => {
  for (const outcome of ['pending', 'rejected', 'review_refund_required']) {
    const mock = confirmationSupabaseMock({ atomicOutcome: outcome });
    await confirmMercadoPagoPayment(mock.client, providerPayment({ status: outcome === 'pending' ? 'pending' : 'approved' }), { requestId: null, binding: 'unresolved' });
    assert.equal(mock.calls.includes('claim_order_email_delivery'), false, `outcome ${outcome} must never attempt a claim`);
  }
  const duplicateMock = confirmationSupabaseMock({ atomicOutcome: 'approved', isDuplicate: true });
  await confirmMercadoPagoPayment(duplicateMock.client, providerPayment(), { requestId: null, binding: 'unresolved' });
  assert.equal(duplicateMock.calls.includes('claim_order_email_delivery'), false, 'a duplicate webhook must never attempt a claim');
});

test('confirmMercadoPagoPayment: an email-path failure (claim RPC throws) never changes the returned payment result', async () => {
  const mock = confirmationSupabaseMock({ atomicOutcome: 'approved', claimThrows: true });
  const outcome = await confirmMercadoPagoPayment(mock.client, providerPayment(), { requestId: null, binding: 'unresolved' });
  assert.equal(outcome.result.kind, 'processed');
  if (outcome.result.kind === 'processed') {
    assert.equal(outcome.result.status, 'approved');
    assert.equal(outcome.result.transition, 'approved');
  }
});
