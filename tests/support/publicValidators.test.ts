import assert from 'node:assert/strict';
import test from 'node:test';

import { isValid, parsePublicSupportIntakePayload, SUPPORT_TOPICS } from '../../server/support/publicValidators.ts';

function basePayload(overrides: Record<string, unknown> = {}) {
  return {
    customerName: 'Cliente Web',
    customerEmail: 'cliente@example.test',
    customerPhone: '+54 9 11 1234-5678',
    topic: 'shipping',
    subject: 'Mi pedido no llego',
    orderReference: 'RHB-202610-000099',
    message: 'Hola, todavia no me llego mi pedido.',
    ...overrides,
  };
}

test('a fully valid payload is accepted and normalized', () => {
  const result = parsePublicSupportIntakePayload(basePayload());
  assert.ok(isValid(result));
  if (!isValid(result)) return;
  assert.equal(result.value.customerName, 'Cliente Web');
  assert.equal(result.value.customerEmail, 'cliente@example.test');
  assert.equal(result.value.customerPhone, '+54 9 11 1234-5678');
  assert.equal(result.value.topic, 'shipping');
  assert.equal(result.value.subject, 'Mi pedido no llego');
  assert.equal(result.value.orderReference, 'RHB-202610-000099');
  assert.equal(result.value.message, 'Hola, todavia no me llego mi pedido.');
  assert.equal(result.value.honeypotTriggered, false);
});

test('every one of the 8 allowed topic values is accepted', () => {
  for (const topic of SUPPORT_TOPICS) {
    const result = parsePublicSupportIntakePayload(basePayload({ topic }));
    assert.ok(isValid(result), `topic ${topic} should be valid`);
  }
  assert.equal(SUPPORT_TOPICS.length, 8);
});

test('an unrecognized topic is rejected, and topic is required', () => {
  assert.equal(isValid(parsePublicSupportIntakePayload(basePayload({ topic: 'not_a_real_topic' }))), false);
  assert.equal(isValid(parsePublicSupportIntakePayload(basePayload({ topic: undefined }))), false);
  assert.equal(isValid(parsePublicSupportIntakePayload(basePayload({ topic: '' }))), false);
});

test('subject is optional: absent/null/whitespace-only all normalize to null', () => {
  for (const subject of [undefined, null, '', '   ']) {
    const result = parsePublicSupportIntakePayload(basePayload({ subject }));
    assert.ok(isValid(result));
    if (isValid(result)) assert.equal(result.value.subject, null);
  }
});

test('orderReference is optional: absent/null/whitespace-only all normalize to null, and it is never validated against orders', () => {
  for (const orderReference of [undefined, null, '', '   ']) {
    const result = parsePublicSupportIntakePayload(basePayload({ orderReference }));
    assert.ok(isValid(result));
    if (isValid(result)) assert.equal(result.value.orderReference, null);
  }
  // Not a UUID, not resolved, just opaque text -- stored exactly as given.
  const freeText = parsePublicSupportIntakePayload(basePayload({ orderReference: 'mi numero es 12345-ABC' }));
  assert.ok(isValid(freeText));
  if (isValid(freeText)) assert.equal(freeText.value.orderReference, 'mi numero es 12345-ABC');
});

test('customerPhone is optional: absent/null/whitespace-only all normalize to null, never WhatsApp-normalized', () => {
  for (const customerPhone of [undefined, null, '', '   ']) {
    const result = parsePublicSupportIntakePayload(basePayload({ customerPhone }));
    assert.ok(isValid(result));
    if (isValid(result)) assert.equal(result.value.customerPhone, null);
  }
  const raw = parsePublicSupportIntakePayload(basePayload({ customerPhone: '011 4555-1234' }));
  assert.ok(isValid(raw));
  if (isValid(raw)) assert.equal(raw.value.customerPhone, '011 4555-1234', 'phone digits must pass through untouched, no WhatsApp E.164 normalization yet');
});

test('customerEmail is trimmed and lowercased, format-checked, and bounded', () => {
  const result = parsePublicSupportIntakePayload(basePayload({ customerEmail: '  Cliente@Example.TEST  ' }));
  assert.ok(isValid(result));
  if (isValid(result)) assert.equal(result.value.customerEmail, 'cliente@example.test');

  assert.equal(isValid(parsePublicSupportIntakePayload(basePayload({ customerEmail: 'not-an-email' }))), false);
  assert.equal(isValid(parsePublicSupportIntakePayload(basePayload({ customerEmail: '' }))), false);
  assert.equal(isValid(parsePublicSupportIntakePayload(basePayload({ customerEmail: `${'a'.repeat(250)}@x.co` }))), false);
});

test('field length limits: 160/254/40/200/60/4000', () => {
  assert.equal(isValid(parsePublicSupportIntakePayload(basePayload({ customerName: 'a'.repeat(160) }))), true);
  assert.equal(isValid(parsePublicSupportIntakePayload(basePayload({ customerName: 'a'.repeat(161) }))), false);

  assert.equal(isValid(parsePublicSupportIntakePayload(basePayload({ customerPhone: '1'.repeat(40) }))), true);
  assert.equal(isValid(parsePublicSupportIntakePayload(basePayload({ customerPhone: '1'.repeat(41) }))), false);

  assert.equal(isValid(parsePublicSupportIntakePayload(basePayload({ subject: 'a'.repeat(200) }))), true);
  assert.equal(isValid(parsePublicSupportIntakePayload(basePayload({ subject: 'a'.repeat(201) }))), false);

  assert.equal(isValid(parsePublicSupportIntakePayload(basePayload({ orderReference: 'a'.repeat(60) }))), true);
  assert.equal(isValid(parsePublicSupportIntakePayload(basePayload({ orderReference: 'a'.repeat(61) }))), false);

  assert.equal(isValid(parsePublicSupportIntakePayload(basePayload({ message: 'a'.repeat(4000) }))), true);
  assert.equal(isValid(parsePublicSupportIntakePayload(basePayload({ message: 'a'.repeat(4001) }))), false);
});

test('message is required and cannot be empty', () => {
  assert.equal(isValid(parsePublicSupportIntakePayload(basePayload({ message: '' }))), false);
  assert.equal(isValid(parsePublicSupportIntakePayload(basePayload({ message: '   ' }))), false);
  assert.equal(isValid(parsePublicSupportIntakePayload(basePayload({ message: undefined }))), false);
});

test('customerName is required and cannot be empty', () => {
  assert.equal(isValid(parsePublicSupportIntakePayload(basePayload({ customerName: '' }))), false);
  assert.equal(isValid(parsePublicSupportIntakePayload(basePayload({ customerName: undefined }))), false);
});

test('an extra, unrecognized field is rejected outright', () => {
  assert.equal(isValid(parsePublicSupportIntakePayload(basePayload({ extraField: 'x' }))), false);
});

test('the client cannot smuggle admin-only fields: status, source, createdBy, internalNotes, requestId, orderId', () => {
  for (const key of ['status', 'source', 'createdBy', 'created_by', 'internalNotes', 'requestId', 'orderId', 'created_at', 'updated_at']) {
    const result = parsePublicSupportIntakePayload(basePayload({ [key]: 'anything' }));
    assert.equal(isValid(result), false, `payload with "${key}" must be rejected as an unknown field`);
  }
});

test('a non-object payload is rejected', () => {
  for (const value of [null, undefined, 'string', 42, [], true]) {
    assert.equal(isValid(parsePublicSupportIntakePayload(value)), false);
  }
});

// --- honeypot --------------------------------------------------------------

test('company is an allowed field (the honeypot), and an empty one is a normal, valid submission', () => {
  const result = parsePublicSupportIntakePayload(basePayload({ company: '' }));
  assert.ok(isValid(result));
  if (isValid(result)) assert.equal(result.value.honeypotTriggered, false);
});

test('a filled company field flags honeypotTriggered and skips all other field validation', () => {
  const result = parsePublicSupportIntakePayload({ company: 'Acme Corp', customerEmail: 'not-an-email', topic: 'not-a-topic' });
  assert.ok(isValid(result));
  if (isValid(result)) assert.equal(result.value.honeypotTriggered, true);
});

test('a whitespace-only company field is not treated as filled', () => {
  const result = parsePublicSupportIntakePayload(basePayload({ company: '   ' }));
  assert.ok(isValid(result));
  if (isValid(result)) assert.equal(result.value.honeypotTriggered, false);
});
