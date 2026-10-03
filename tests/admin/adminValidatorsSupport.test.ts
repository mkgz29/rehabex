import assert from 'node:assert/strict';
import test from 'node:test';

import {
  isValid,
  parseCreateSupportRequestPayload,
  parseGetSupportRequestPayload,
  parseListSupportRequestsPayload,
  parseUpdateSupportRequestNotesPayload,
  parseUpdateSupportRequestStatusPayload,
} from '../../server/admin/validators';

const SUPPORT_ID = '22222222-2222-4222-8222-222222222222';
const ORDER_ID = '33333333-3333-4333-8333-333333333333';
const NOW = new Date().toISOString();

const VALID_CREATE = {
  customerName: 'Cliente Real',
  customerEmail: 'cliente@example.test',
  customerPhone: '+54 9 11 1234-5678',
  subject: 'No llego mi pedido',
  message: 'Hola, todavia no me llego el pedido.',
  orderId: ORDER_ID,
};

test('parseCreateSupportRequestPayload accepts a well-formed payload, with or without phone/order', () => {
  assert.ok(isValid(parseCreateSupportRequestPayload(VALID_CREATE)));
  assert.ok(isValid(parseCreateSupportRequestPayload({ ...VALID_CREATE, customerPhone: null, orderId: null })));
  assert.ok(isValid(parseCreateSupportRequestPayload({ ...VALID_CREATE, customerPhone: undefined, orderId: undefined })));
});

test('parseCreateSupportRequestPayload rejects unknown fields', () => {
  for (const key of ['id', 'status', 'internalNotes', 'createdBy', 'created_at']) {
    const result = parseCreateSupportRequestPayload({ ...VALID_CREATE, [key]: 'x' });
    assert.equal(isValid(result), false, `expected ${key} to be rejected`);
  }
});

test('parseCreateSupportRequestPayload rejects an empty or oversized customer name', () => {
  assert.equal(isValid(parseCreateSupportRequestPayload({ ...VALID_CREATE, customerName: '' })), false);
  assert.equal(isValid(parseCreateSupportRequestPayload({ ...VALID_CREATE, customerName: '   ' })), false);
  assert.equal(isValid(parseCreateSupportRequestPayload({ ...VALID_CREATE, customerName: 'x'.repeat(161) })), false);
});

test('parseCreateSupportRequestPayload rejects a malformed email', () => {
  for (const customerEmail of ['', 'not-an-email', 'missing-domain@', '@missing-local.test', 'spaces in@example.test']) {
    const result = parseCreateSupportRequestPayload({ ...VALID_CREATE, customerEmail });
    assert.equal(isValid(result), false, `expected "${customerEmail}" to be rejected`);
  }
});

test('parseCreateSupportRequestPayload rejects an oversized phone and preserves the original string otherwise', () => {
  assert.equal(isValid(parseCreateSupportRequestPayload({ ...VALID_CREATE, customerPhone: '1'.repeat(41) })), false);
  const result = parseCreateSupportRequestPayload(VALID_CREATE);
  assert.ok(isValid(result));
  if (isValid(result)) assert.equal(result.value.customerPhone, '+54 9 11 1234-5678');
});

test('parseCreateSupportRequestPayload rejects an invalid orderId (not absent, not a UUID)', () => {
  assert.equal(isValid(parseCreateSupportRequestPayload({ ...VALID_CREATE, orderId: 'not-a-uuid' })), false);
});

test('parseCreateSupportRequestPayload rejects an empty or oversized subject/message', () => {
  assert.equal(isValid(parseCreateSupportRequestPayload({ ...VALID_CREATE, subject: '' })), false);
  assert.equal(isValid(parseCreateSupportRequestPayload({ ...VALID_CREATE, subject: 'x'.repeat(201) })), false);
  assert.equal(isValid(parseCreateSupportRequestPayload({ ...VALID_CREATE, message: '' })), false);
  assert.equal(isValid(parseCreateSupportRequestPayload({ ...VALID_CREATE, message: 'x'.repeat(4001) })), false);
});

test('parseUpdateSupportRequestStatusPayload accepts each real status and rejects anything else', () => {
  for (const status of ['open', 'answered', 'resolved']) {
    assert.ok(isValid(parseUpdateSupportRequestStatusPayload({ id: SUPPORT_ID, status, expectedUpdatedAt: NOW })));
  }
  for (const status of ['closed', 'pending', 'OPEN', '', 1, null]) {
    const result = parseUpdateSupportRequestStatusPayload({ id: SUPPORT_ID, status, expectedUpdatedAt: NOW });
    assert.equal(isValid(result), false, `expected status ${JSON.stringify(status)} to be rejected`);
  }
});

test('parseUpdateSupportRequestStatusPayload rejects a non-UUID id and a missing version', () => {
  assert.equal(isValid(parseUpdateSupportRequestStatusPayload({ id: 'not-a-uuid', status: 'open', expectedUpdatedAt: NOW })), false);
  assert.equal(isValid(parseUpdateSupportRequestStatusPayload({ id: SUPPORT_ID, status: 'open', expectedUpdatedAt: undefined })), false);
  assert.equal(isValid(parseUpdateSupportRequestStatusPayload({ id: SUPPORT_ID, status: 'open', expectedUpdatedAt: 'not-a-date' })), false);
});

test('parseUpdateSupportRequestNotesPayload accepts an empty/absent note (clearing) and a normal note', () => {
  assert.ok(isValid(parseUpdateSupportRequestNotesPayload({ id: SUPPORT_ID, internalNotes: null, expectedUpdatedAt: NOW })));
  assert.ok(isValid(parseUpdateSupportRequestNotesPayload({ id: SUPPORT_ID, internalNotes: '', expectedUpdatedAt: NOW })));
  const result = parseUpdateSupportRequestNotesPayload({ id: SUPPORT_ID, internalNotes: 'Llamar mañana.', expectedUpdatedAt: NOW });
  assert.ok(isValid(result));
  if (isValid(result)) assert.equal(result.value.internalNotes, 'Llamar mañana.');
});

test('parseUpdateSupportRequestNotesPayload normalizes an empty/whitespace note to null', () => {
  const result = parseUpdateSupportRequestNotesPayload({ id: SUPPORT_ID, internalNotes: '   ', expectedUpdatedAt: NOW });
  assert.ok(isValid(result));
  if (isValid(result)) assert.equal(result.value.internalNotes, null);
});

test('parseUpdateSupportRequestNotesPayload rejects an oversized note and unsafe characters', () => {
  assert.equal(isValid(parseUpdateSupportRequestNotesPayload({ id: SUPPORT_ID, internalNotes: 'x'.repeat(4001), expectedUpdatedAt: NOW })), false);
  assert.equal(isValid(parseUpdateSupportRequestNotesPayload({ id: SUPPORT_ID, internalNotes: '<script>', expectedUpdatedAt: NOW })), false);
});

test('parseListSupportRequestsPayload accepts no filter, each real status, and rejects anything else', () => {
  assert.ok(isValid(parseListSupportRequestsPayload({})));
  assert.ok(isValid(parseListSupportRequestsPayload({ status: null })));
  for (const status of ['open', 'answered', 'resolved']) {
    assert.ok(isValid(parseListSupportRequestsPayload({ status })));
  }
  assert.equal(isValid(parseListSupportRequestsPayload({ status: 'bogus' })), false);
  assert.equal(isValid(parseListSupportRequestsPayload({ status: 'open', extra: true })), false);
});

test('parseGetSupportRequestPayload accepts a UUID and rejects anything else', () => {
  assert.ok(isValid(parseGetSupportRequestPayload({ id: SUPPORT_ID })));
  assert.equal(isValid(parseGetSupportRequestPayload({ id: 'not-a-uuid' })), false);
  assert.equal(isValid(parseGetSupportRequestPayload({ id: SUPPORT_ID, extra: true })), false);
  assert.equal(isValid(parseGetSupportRequestPayload({})), false);
});
