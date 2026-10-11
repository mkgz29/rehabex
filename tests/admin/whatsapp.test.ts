import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

import {
  buildOrderWhatsAppMessage,
  buildSupportWhatsAppMessage,
  buildWhatsAppUrl,
  normalizePhoneForWhatsApp,
} from '../../src/admin/whatsapp.ts';

// --- normalizePhoneForWhatsApp ----------------------------------------------

test('explicit "+" international: cleans separators, never alters the structure given', () => {
  assert.equal(normalizePhoneForWhatsApp('+54 9 381 555 1234'), '5493815551234');
  assert.equal(normalizePhoneForWhatsApp('+1 202 555 0100'), '12025550100');
});

test('explicit "+" without a mobile "9": kept exactly as given, never inserts a 9', () => {
  assert.equal(normalizePhoneForWhatsApp('+54 381 5551234'), '543815551234');
});

test('already international, no "+", pure digits starting with 54: accepted as-is', () => {
  assert.equal(normalizePhoneForWhatsApp('5493815551234'), '5493815551234');
});

test('Argentina local mobile format "0<area> 15 <number>": rewritten with 54 9, since "15" is an explicit mobile signal', () => {
  assert.equal(normalizePhoneForWhatsApp('0381 15 5551234'), '5493815551234');
});

test('Argentina local mobile format tolerates dashes/parens/dots as separators', () => {
  assert.equal(normalizePhoneForWhatsApp('(0381) 15-5551234'), '5493815551234');
});

test('rejects a bare "<area> <number>" with no +, no leading 0 and no 15 marker: ambiguous, never guessed', () => {
  assert.equal(normalizePhoneForWhatsApp('381 5551234'), null);
});

test('rejects "0<area> <number>" without the "15" marker: the trunk prefix alone does not imply mobile', () => {
  assert.equal(normalizePhoneForWhatsApp('0381 5551234'), null);
});

test('rejects non-numeric input', () => {
  assert.equal(normalizePhoneForWhatsApp('abc1234567'), null);
});

test('rejects empty and whitespace-only input', () => {
  assert.equal(normalizePhoneForWhatsApp(''), null);
  assert.equal(normalizePhoneForWhatsApp('   '), null);
});

test('rejects fewer than 8 digits', () => {
  assert.equal(normalizePhoneForWhatsApp('+1234567'), null);
});

test('rejects more than 15 digits', () => {
  assert.equal(normalizePhoneForWhatsApp('+1234567890123456'), null);
});

test('rejects "+" with no digits at all', () => {
  assert.equal(normalizePhoneForWhatsApp('+'), null);
  assert.equal(normalizePhoneForWhatsApp('+   '), null);
});

test('final normalized digits always satisfy ^[1-9]\\d{7,14}$', () => {
  const normalized = normalizePhoneForWhatsApp('+54 9 381 555 1234');
  assert.match(normalized ?? '', /^[1-9]\d{7,14}$/);
});

// --- buildWhatsAppUrl --------------------------------------------------------

test('buildWhatsAppUrl produces a wa.me link with the normalized digits and an encoded message', () => {
  const url = buildWhatsAppUrl('+54 9 381 555 1234', 'Hola, probando');
  assert.ok(url?.startsWith('https://wa.me/5493815551234?text='));
  assert.ok(new URL(url!).searchParams.get('text') === 'Hola, probando');
});

test('buildWhatsAppUrl correctly encodes spaces, accents and symbols, never injecting an extra query param', () => {
  const message = 'Hola José, ¿cómo estás? Tu pedido & envío';
  const url = buildWhatsAppUrl('+54 9 381 555 1234', message);
  const parsed = new URL(url!);
  assert.equal(parsed.searchParams.get('text'), message);
  // Exactly one query parameter -- the message text cannot smuggle in a
  // second one (e.g. via a literal "&key=value" in the text).
  assert.equal(Array.from(parsed.searchParams.keys()).length, 1);
});

test('buildWhatsAppUrl returns null when the phone does not normalize -- never a broken link', () => {
  assert.equal(buildWhatsAppUrl('381 5551234', 'Hola'), null);
  assert.equal(buildWhatsAppUrl('', 'Hola'), null);
});

// --- message builders ---------------------------------------------------------

test('buildSupportWhatsAppMessage: base template with no order reference', () => {
  assert.equal(
    buildSupportWhatsAppMessage('Ana'),
    'Hola Ana, somos de Rehabex. Te contactamos por tu consulta.',
  );
});

test('buildSupportWhatsAppMessage: includes the reference when present', () => {
  assert.equal(
    buildSupportWhatsAppMessage('Ana', 'RHB-202610-000099'),
    'Hola Ana, somos de Rehabex. Te contactamos por tu consulta sobre el pedido RHB-202610-000099.',
  );
});

test('buildSupportWhatsAppMessage: null/empty reference falls back to the base template', () => {
  assert.equal(buildSupportWhatsAppMessage('Ana', null), 'Hola Ana, somos de Rehabex. Te contactamos por tu consulta.');
  assert.equal(buildSupportWhatsAppMessage('Ana', '   '), 'Hola Ana, somos de Rehabex. Te contactamos por tu consulta.');
});

test('buildSupportWhatsAppMessage: trims whitespace around the customer name', () => {
  assert.equal(
    buildSupportWhatsAppMessage('  Ana  '),
    'Hola Ana, somos de Rehabex. Te contactamos por tu consulta.',
  );
});

test('buildOrderWhatsAppMessage: base template with a friendly reference', () => {
  assert.equal(
    buildOrderWhatsAppMessage('Carlos', 'RHB-202610-000042'),
    'Hola Carlos, somos de Rehabex. Te contactamos por tu pedido RHB-202610-000042.',
  );
});

test('buildOrderWhatsAppMessage: trims whitespace around name and reference', () => {
  assert.equal(
    buildOrderWhatsAppMessage('  Carlos  ', '  RHB-202610-000042  '),
    'Hola Carlos, somos de Rehabex. Te contactamos por tu pedido RHB-202610-000042.',
  );
});

test('message builders never produce a UUID or an email address in their output', () => {
  const uuidPattern = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
  const supportMessage = buildSupportWhatsAppMessage('Ana', 'RHB-202610-000099');
  const orderMessage = buildOrderWhatsAppMessage('Carlos', 'RHB-202610-000042');
  for (const message of [supportMessage, orderMessage]) {
    assert.doesNotMatch(message, uuidPattern);
    assert.doesNotMatch(message, /@/);
  }
});

test('message builders accept an optional brand name, defaulting to Rehabex', () => {
  assert.equal(
    buildSupportWhatsAppMessage('Ana', null, 'OtraMarca'),
    'Hola Ana, somos de OtraMarca. Te contactamos por tu consulta.',
  );
  assert.equal(
    buildOrderWhatsAppMessage('Carlos', 'RHB-1', 'OtraMarca'),
    'Hola Carlos, somos de OtraMarca. Te contactamos por tu pedido RHB-1.',
  );
});

// --- security contract ---------------------------------------------------------

test('SECURITY CONTRACT: src/admin/whatsapp.ts is pure logic -- no fetch, no Supabase, no adminApi, no window access, no side effects', () => {
  const content = readFileSync(join(process.cwd(), 'src/admin/whatsapp.ts'), 'utf8');
  assert.doesNotMatch(content, /from ['"]@supabase|createClient|\.rpc\(|SUPABASE_SERVICE_ROLE_KEY/);
  assert.doesNotMatch(content, /\bfetch\(/);
  assert.doesNotMatch(content, /adminApi/i);
  assert.doesNotMatch(content, /window\.|document\./);
});
