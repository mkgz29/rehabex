import assert from 'node:assert/strict';
import test from 'node:test';

import { parsePublicWithdrawalPayload } from '../../server/withdrawal/publicValidators.ts';

const valid = (overrides: Record<string, unknown> = {}) => ({
  customerName: 'Cliente Local',
  customerEmail: 'cliente@example.test',
  customerPhone: '+54 11 5555 5555',
  orderReference: 'RHB-202610-000123',
  message: 'Quiero revocar la compra.',
  ...overrides,
});

test('accepts and normalizes the minimum identification fields', () => {
  const result = parsePublicWithdrawalPayload(valid({ customerEmail: ' Cliente@Example.TEST ', customerPhone: '', message: '' }));
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.customerEmail, 'cliente@example.test');
  assert.equal(result.value.customerPhone, null);
  assert.equal(result.value.message, null);
  assert.equal(result.value.orderReference, 'RHB-202610-000123');
});

test('requires name, email and order reference and validates lengths and markup', () => {
  for (const payload of [
    valid({ customerName: '' }), valid({ customerEmail: 'not-email' }), valid({ orderReference: '' }),
    valid({ orderReference: 'x'.repeat(61) }), valid({ message: 'x'.repeat(2001) }), valid({ customerName: '<script>' }),
  ]) assert.equal(parsePublicWithdrawalPayload(payload).ok, false);
});

test('rejects fields that could control orders, payments or admin state', () => {
  for (const field of ['orderId', 'paymentId', 'refund', 'status', 'source', 'internalNotes', 'requestCode', 'responseDueAt']) {
    assert.equal(parsePublicWithdrawalPayload(valid({ [field]: 'anything' })).ok, false, field);
  }
});

test('the non-semantic honeypot reports success without validating other fields', () => {
  const result = parsePublicWithdrawalPayload({ formGuard: 'filled', customerEmail: 'invalid' });
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.value.honeypotTriggered, true);
});
