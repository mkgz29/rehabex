import assert from 'node:assert/strict';
import test from 'node:test';

import { buildWhatsAppMessage, buildWhatsAppUrl, normalizePhoneForWhatsApp } from '../../src/admin/whatsapp';

// --- normalizePhoneForWhatsApp -------------------------------------------------

test('normalizePhoneForWhatsApp accepts an already-international number with a leading +', () => {
  const result = normalizePhoneForWhatsApp('+54 9 381 555 1234');
  assert.deepEqual(result, { ok: true, digits: '5493815551234' });
});

test('normalizePhoneForWhatsApp accepts a bare digit-only Argentine international number (no +)', () => {
  const result = normalizePhoneForWhatsApp('5493815551234');
  assert.deepEqual(result, { ok: true, digits: '5493815551234' });
});

test('normalizePhoneForWhatsApp accepts an international number without the mobile "9" marker, preserving it exactly as given', () => {
  // The admin typed +54 381 ... (no 9). We never insert a 9 that was not
  // there -- "mantener codigo internacional cuando ya viene explicito".
  const result = normalizePhoneForWhatsApp('+54 381 5551234');
  assert.deepEqual(result, { ok: true, digits: '543815551234' });
});

test('normalizePhoneForWhatsApp accepts Argentina\'s standard local mobile dialing format (0<area> 15 <number>)', () => {
  const result = normalizePhoneForWhatsApp('0381 15 5551234');
  assert.deepEqual(result, { ok: true, digits: '5493815551234' });
});

test('normalizePhoneForWhatsApp strips extra formatting characters (dashes, parens, dots)', () => {
  const result = normalizePhoneForWhatsApp('+54 (381) 555-1234');
  assert.deepEqual(result, { ok: true, digits: '543815551234' });
});

test('normalizePhoneForWhatsApp accepts a non-Argentine international number unchanged', () => {
  const result = normalizePhoneForWhatsApp('+1 202 555 0100');
  assert.deepEqual(result, { ok: true, digits: '12025550100' });
});

test('normalizePhoneForWhatsApp rejects empty or whitespace-only input', () => {
  assert.deepEqual(normalizePhoneForWhatsApp(''), { ok: false });
  assert.deepEqual(normalizePhoneForWhatsApp('   '), { ok: false });
});

test('normalizePhoneForWhatsApp rejects impossible/garbage input', () => {
  assert.deepEqual(normalizePhoneForWhatsApp('abc'), { ok: false });
  assert.deepEqual(normalizePhoneForWhatsApp('123'), { ok: false });
  assert.deepEqual(normalizePhoneForWhatsApp('+'), { ok: false });
});

// --- E.164 structural guards: "+" does not mean "accept anything" ---------------

test('normalizePhoneForWhatsApp rejects an explicit international number that is too long (over the E.164 15-digit limit)', () => {
  assert.deepEqual(normalizePhoneForWhatsApp('+1234567890123456'), { ok: false }); // 16 digits
});

test('normalizePhoneForWhatsApp rejects an explicit international number that is too short', () => {
  assert.deepEqual(normalizePhoneForWhatsApp('+1234567'), { ok: false }); // 7 digits
});

test('normalizePhoneForWhatsApp rejects an explicit international number whose result would start with 0 -- no real country code starts with 0', () => {
  assert.deepEqual(normalizePhoneForWhatsApp('+0123456789'), { ok: false });
});

test('normalizePhoneForWhatsApp accepts an explicit international number at exactly the 15-digit E.164 maximum', () => {
  assert.deepEqual(normalizePhoneForWhatsApp('+123456789012345'), { ok: true, digits: '123456789012345' }); // 15 digits
});

test('normalizePhoneForWhatsApp rejects an ambiguous bare "area number" with no +, no leading 0, no 15 marker -- never guesses the mobile 9', () => {
  // This is the documented, deliberate rejection: there is no reliable
  // signal here for mobile vs. landline, so we refuse rather than invent a digit.
  const result = normalizePhoneForWhatsApp('381 5551234');
  assert.deepEqual(result, { ok: false });
});

test('normalizePhoneForWhatsApp never mutates or reports back the original string -- only ok/digits', () => {
  const result = normalizePhoneForWhatsApp('+54 9 381 555 1234');
  assert.ok(result.ok);
  assert.deepEqual(Object.keys(result).sort(), ['digits', 'ok']);
});

// --- buildWhatsAppUrl -----------------------------------------------------------

test('buildWhatsAppUrl produces the expected wa.me shape with the digits in the path', () => {
  const url = buildWhatsAppUrl('5493815551234', 'Hola');
  assert.equal(url, 'https://wa.me/5493815551234?text=Hola');
});

test('buildWhatsAppUrl encodes the message correctly, including spaces and accents', () => {
  const url = buildWhatsAppUrl('5493815551234', 'Hola José, ¿cómo estás?');
  const parsed = new URL(url);
  assert.equal(parsed.searchParams.get('text'), 'Hola José, ¿cómo estás?');
});

test('buildWhatsAppUrl never lets the message text inject extra query parameters', () => {
  const malicious = 'hola&foo=bar&redirect=https://evil.test';
  const url = buildWhatsAppUrl('5493815551234', malicious);
  const parsed = new URL(url);
  assert.equal(parsed.searchParams.get('text'), malicious);
  assert.equal(parsed.searchParams.get('foo'), null);
  assert.equal(parsed.searchParams.get('redirect'), null);
  assert.equal([...parsed.searchParams.keys()].length, 1);
});

// --- buildWhatsAppMessage -------------------------------------------------

test('buildWhatsAppMessage uses the no-order template when there is no order number', () => {
  assert.equal(buildWhatsAppMessage('Juan Perez', null), 'Hola Juan Perez, somos Rehabex. Te escribimos por tu consulta.');
  assert.equal(buildWhatsAppMessage('Juan Perez', undefined), 'Hola Juan Perez, somos Rehabex. Te escribimos por tu consulta.');
  assert.equal(buildWhatsAppMessage('Juan Perez', ''), 'Hola Juan Perez, somos Rehabex. Te escribimos por tu consulta.');
});

test('buildWhatsAppMessage uses the order template when an order number exists', () => {
  assert.equal(
    buildWhatsAppMessage('Juan Perez', 'RHB-202610-000047'),
    'Hola Juan Perez, somos Rehabex. Te escribimos por tu pedido RHB-202610-000047.',
  );
});

test('buildWhatsAppMessage never includes email, internal status, notes or a payment id', () => {
  const message = buildWhatsAppMessage('Juan Perez', 'RHB-202610-000047');
  for (const forbidden of ['@', 'payment', 'nota', 'status', 'open', 'resolved', 'answered']) {
    assert.doesNotMatch(message.toLowerCase(), new RegExp(forbidden), `message must not mention "${forbidden}"`);
  }
});
