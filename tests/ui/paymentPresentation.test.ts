import assert from 'node:assert/strict';
import test from 'node:test';

import { classifyPaymentConfirmation, requestPaymentSync } from '../../src/services/orderStatusService';
import { recoveryNotice } from '../../src/services/paymentMessages';
import {
  attentionLevel,
  buyerLabel,
  orderAmount,
  orderItemsLabel,
  orderReference,
  paymentReference,
  type AdminOrder,
} from '../../src/admin/orderPresentation';
import type { CheckoutSnapshot } from '../../src/cart/checkoutSnapshot';

const snapshot: CheckoutSnapshot = {
  version: 1,
  orderId: '159e3369-63a9-4879-b5ce-8f0db6369508',
  statusToken: 'a'.repeat(43),
  createdAt: '2026-09-18T04:12:10.658Z',
  lines: [{ lineId: '11111111-1111-4111-8111-111111111111', productId: '22222222-2222-4222-8222-222222222222', quantity: 1 }],
};

function fakeResponse(status: number, body: unknown, headers: Record<string, string> = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name: string) => headers[name] ?? null },
    json: async () => body,
  } as unknown as Response;
}

test('order state is derived only from what the backend persisted', () => {
  assert.equal(classifyPaymentConfirmation({ payment_status: 'approved', order_status: 'confirmed' }), 'approved');
  // Approved money on an order that never confirmed is not a success for the buyer.
  assert.equal(classifyPaymentConfirmation({ payment_status: 'approved', order_status: 'on_hold' }), 'unknown');
  assert.equal(classifyPaymentConfirmation({ payment_status: 'unpaid', order_status: 'pending_payment' }), 'pending');
  assert.equal(classifyPaymentConfirmation({ payment_status: 'rejected', order_status: 'failed' }), 'rejected');
  assert.equal(classifyPaymentConfirmation({ payment_status: 'unpaid', order_status: 'expired' }), 'expired');
  assert.equal(classifyPaymentConfirmation(null), 'unknown');
});

test('the buyer is told what the recovery attempt actually found', () => {
  assert.match(String(recoveryNotice('confirmed', null)), /registramos la confirmacion/);
  assert.match(String(recoveryNotice('no_payment_found', null)), /todavia no hay un pago/);
  assert.match(String(recoveryNotice('ambiguous_payments', null)), /No vuelvas a pagar/);
  assert.match(String(recoveryNotice('cooldown', 17)), /17 segundos/);
  assert.match(String(recoveryNotice('rate_limited', 42)), /42 segundos/);
  assert.match(String(recoveryNotice('provider_unavailable', null)), /No pudimos consultar/);
  assert.equal(recoveryNotice(null, null), null);
  assert.equal(recoveryNotice('already_settled', null), null);
});

test('the sync client sends no payment data and survives every failure mode', async () => {
  let sentBody: string | null = null;
  const confirmed = await requestPaymentSync(snapshot, (async (_url: string, init: RequestInit) => {
    sentBody = String(init.body);
    return fakeResponse(200, { order: { payment_status: 'approved', order_status: 'confirmed' }, recovery: 'confirmed' });
  }) as never);
  assert.deepEqual(JSON.parse(String(sentBody)), { orderId: snapshot.orderId });
  assert.deepEqual(confirmed, { state: 'approved', recovery: 'confirmed', retryAfterSeconds: null });

  const limited = await requestPaymentSync(snapshot, (async () => fakeResponse(429, {}, { 'Retry-After': '42' })) as never);
  assert.deepEqual(limited, { state: 'unknown', recovery: 'rate_limited', retryAfterSeconds: 42 });

  const cooldown = await requestPaymentSync(snapshot, (async () => fakeResponse(200, { order: { payment_status: 'unpaid', order_status: 'pending_payment' }, recovery: 'cooldown' }, { 'Retry-After': '17' })) as never);
  assert.deepEqual(cooldown, { state: 'pending', recovery: 'cooldown', retryAfterSeconds: 17 });

  const offline = await requestPaymentSync(snapshot, (async () => { throw new Error('network'); }) as never);
  assert.deepEqual(offline, { state: 'unknown', recovery: 'unreachable', retryAfterSeconds: null });

  const broken = await requestPaymentSync(snapshot, (async () => fakeResponse(503, {})) as never);
  assert.equal(broken.recovery, 'provider_unavailable');
});

test('the admin table surfaces money that did not reach a confirmed order', () => {
  const settled: AdminOrder = { payment_status: 'approved', order_status: 'confirmed' };
  assert.equal(attentionLevel(settled), 'settled');
  // Exactly the failure this incident produced: paid but never confirmed.
  assert.equal(attentionLevel({ payment_status: 'approved', order_status: 'pending_payment' }), 'attention');
  assert.equal(attentionLevel({ payment_status: 'approved', order_status: 'on_hold', review_required: true }), 'attention');
  assert.equal(attentionLevel({ payment_status: 'unpaid', order_status: 'pending_payment' }), 'waiting');
  assert.equal(attentionLevel({ payment_status: 'unpaid', order_status: 'expired' }), 'settled');
  assert.equal(attentionLevel({ payment_status: 'approved', order_status: 'confirmed', refund_required: true }), 'attention');
  assert.equal(attentionLevel({ payment_status: 'charged_back', order_status: 'on_hold' }), 'attention');
});

test('the admin row reads the real order contract and shows no unnecessary personal data', () => {
  const order: AdminOrder = {
    id: '159e3369-63a9-4879-b5ce-8f0db6369508',
    order_number: 'RHB-202609-000013',
    payment_status: 'approved',
    order_status: 'confirmed',
    total_amount: '100.00',
    mercadopago_payment_id: '178632439037',
    customer_name: 'Cliente Prueba',
    customer_email: 'cliente@example.test',
    order_items: [{ product_name: 'TEST-MP-OTHE-20260916', quantity: 2 }],
  };
  assert.equal(orderReference(order), 'RHB-202609-000013');
  assert.equal(paymentReference(order), '178632439037');
  assert.equal(orderAmount(order), 100);
  assert.equal(orderItemsLabel(order), 'TEST-MP-OTHE-20260916 x2');
  // Name wins over e-mail, and neither phone nor address is ever part of a row.
  assert.equal(buyerLabel(order), 'Cliente Prueba');
  assert.equal(buyerLabel({ customer_email: 'cliente@example.test' }), 'cliente@example.test');
  assert.equal(buyerLabel({}), 'sin datos');

  // Legacy columns no longer exist; the row must not silently render blanks.
  assert.equal(paymentReference({}), 'sin pago');
  assert.equal(orderItemsLabel({}), 'sin items');
});
