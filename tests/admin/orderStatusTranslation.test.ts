import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ORDER_STATUS_LABELS,
  PAYMENT_STATUS_LABELS,
  orderLabel,
  paymentLabel,
  type AdminOrder,
} from '../../src/admin/orderPresentation';

// The full, authoritative enum value sets from the real database schema
// (supabase/migrations/202609110103_orders_commerce_foundation.sql). This is
// deliberately hardcoded here, not imported, so a future migration that
// changes the enum without updating the translation map fails this test
// instead of silently leaking an untranslated value in the UI.
const REAL_PAYMENT_STATUS_VALUES = ['unpaid', 'pending', 'approved', 'rejected', 'cancelled', 'refunded', 'charged_back'];
const REAL_ORDER_STATUS_VALUES = [
  'draft',
  'pending_payment',
  'confirmed',
  'on_hold',
  'cancelled',
  'completed',
  'expired',
  'refunded',
  'failed',
];

test('every real payment_status value has a Spanish translation', () => {
  assert.equal(REAL_PAYMENT_STATUS_VALUES.length, 7);
  for (const value of REAL_PAYMENT_STATUS_VALUES) {
    const label = paymentLabel({ payment_status: value });
    assert.ok(PAYMENT_STATUS_LABELS[value], `missing translation for payment_status "${value}"`);
    assert.equal(label, PAYMENT_STATUS_LABELS[value]);
    assert.notEqual(label, value);
    assert.notEqual(label, 'Estado sin identificar');
  }
});

test('every real order_status value has a Spanish translation', () => {
  assert.equal(REAL_ORDER_STATUS_VALUES.length, 9);
  for (const value of REAL_ORDER_STATUS_VALUES) {
    const label = orderLabel({ order_status: value });
    assert.ok(ORDER_STATUS_LABELS[value], `missing translation for order_status "${value}"`);
    assert.equal(label, ORDER_STATUS_LABELS[value]);
    assert.notEqual(label, value);
    assert.notEqual(label, 'Estado sin identificar');
  }
});

test('the translation maps contain nothing beyond the real enum values', () => {
  assert.deepEqual(Object.keys(PAYMENT_STATUS_LABELS).sort(), [...REAL_PAYMENT_STATUS_VALUES].sort());
  assert.deepEqual(Object.keys(ORDER_STATUS_LABELS).sort(), [...REAL_ORDER_STATUS_VALUES].sort());
});

test('an unrecognized or missing status falls back to "Estado sin identificar", never the raw value', () => {
  assert.equal(paymentLabel({ payment_status: 'some_future_value' } as AdminOrder), 'Estado sin identificar');
  assert.equal(orderLabel({ order_status: 'some_future_value' } as AdminOrder), 'Estado sin identificar');
  assert.equal(paymentLabel({}), 'Estado sin identificar');
  assert.equal(orderLabel({}), 'Estado sin identificar');
  assert.equal(paymentLabel({ payment_status: '' }), 'Estado sin identificar');
  assert.equal(orderLabel({ order_status: null }), 'Estado sin identificar');
});
