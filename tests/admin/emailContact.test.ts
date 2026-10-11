import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

import {
  buildGmailComposeUrl,
  buildSupportEmailBody,
  buildSupportEmailSubject,
  isPlausibleEmail,
} from '../../src/admin/emailContact.ts';

// --- subject/body builders -----------------------------------------------------

test('buildSupportEmailSubject: base template with no subject', () => {
  assert.equal(buildSupportEmailSubject(), 'Consulta Rehabex');
  assert.equal(buildSupportEmailSubject(null), 'Consulta Rehabex');
  assert.equal(buildSupportEmailSubject('   '), 'Consulta Rehabex');
});

test('buildSupportEmailSubject: includes the ticket subject when present', () => {
  assert.equal(buildSupportEmailSubject('No llego mi pedido'), 'Consulta Rehabex — No llego mi pedido');
});

test('buildSupportEmailSubject: accepts an optional brand name, defaulting to Rehabex', () => {
  assert.equal(buildSupportEmailSubject('Consulta general', 'OtraMarca'), 'Consulta OtraMarca — Consulta general');
});

test('buildSupportEmailBody: greets the customer by name and signs as the brand', () => {
  const body = buildSupportEmailBody('Ana Gómez');
  assert.equal(body, 'Hola Ana Gómez,\n\nSomos de Rehabex. Te contactamos por la consulta que nos enviaste.\n\nSaludos,\nRehabex');
});

test('buildSupportEmailBody: trims whitespace around the name', () => {
  assert.equal(buildSupportEmailBody('  Ana Gómez  '), buildSupportEmailBody('Ana Gómez'));
});

test('buildSupportEmailBody never includes email, UUID, internal_notes or status -- there is nothing to leak since the function has no such parameters', () => {
  const body = buildSupportEmailBody('Ana Gómez');
  assert.doesNotMatch(body, /@/);
  assert.doesNotMatch(body, /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
});

// --- isPlausibleEmail ------------------------------------------------------------

test('isPlausibleEmail: accepts a well-formed address', () => {
  assert.equal(isPlausibleEmail('cliente@example.test'), true);
});

test('isPlausibleEmail: rejects missing @, missing domain, empty, or whitespace-only', () => {
  for (const value of ['not-an-email', 'cliente@', '@example.test', '', '   ']) {
    assert.equal(isPlausibleEmail(value), false, `expected "${value}" to be rejected`);
  }
});

// --- buildGmailComposeUrl -------------------------------------------------------

test('a valid email produces a Gmail compose link with the correct recipient', () => {
  const url = buildGmailComposeUrl('cliente@example.test', 'Consulta Rehabex', 'Hola Ana,\n\nTexto.');
  assert.ok(url?.startsWith('https://mail.google.com/mail/?'));
  const parsed = new URL(url!);
  assert.equal(parsed.searchParams.get('to'), 'cliente@example.test');
  assert.equal(parsed.searchParams.get('view'), 'cm');
  assert.equal(parsed.searchParams.get('fs'), '1');
});

test('subject and body are passed through exactly, correctly encoded (accents, newlines, symbols, &)', () => {
  const subject = 'Consulta Rehabex — No llegó mi pedido';
  const body = 'Hola José,\n\n¿Cómo estás? Pedido & referencia.\n\nSaludos,\nRehabex';
  const url = buildGmailComposeUrl('cliente@example.test', subject, body)!;
  const parsed = new URL(url);
  assert.equal(parsed.searchParams.get('su'), subject);
  assert.equal(parsed.searchParams.get('body'), body);
  // Exactly the 5 expected params -- body/subject text cannot smuggle in more.
  assert.equal(Array.from(parsed.searchParams.keys()).length, 5);
});

test('an invalid or missing email returns null -- never a broken Gmail link', () => {
  assert.equal(buildGmailComposeUrl('not-an-email', 'Asunto', 'Cuerpo'), null);
  assert.equal(buildGmailComposeUrl('', 'Asunto', 'Cuerpo'), null);
  assert.equal(buildGmailComposeUrl('   ', 'Asunto', 'Cuerpo'), null);
});

test('leading/trailing whitespace around the email is trimmed before validation and use', () => {
  const url = buildGmailComposeUrl('  cliente@example.test  ', 'Asunto', 'Cuerpo')!;
  assert.equal(new URL(url).searchParams.get('to'), 'cliente@example.test');
});

// --- security contract ---------------------------------------------------------

test('SECURITY CONTRACT: src/admin/emailContact.ts is pure logic -- no fetch, no Supabase, no Gmail API, no OAuth, no credentials, no window access', () => {
  const content = readFileSync(join(process.cwd(), 'src/admin/emailContact.ts'), 'utf8');
  // Check actual code patterns, not prose: this file's own comments
  // legitimately explain *why* it avoids OAuth/the Gmail API, which would
  // otherwise false-positive a bare substring check against those words.
  assert.doesNotMatch(content, /from ['"]@supabase|createClient|\.rpc\(|SUPABASE_SERVICE_ROLE_KEY/);
  assert.doesNotMatch(content, /\bfetch\(/);
  assert.doesNotMatch(content, /gmail\.googleapis|access_token\s*[:=]|client_secret\s*[:=]/i);
  assert.doesNotMatch(content, /window\.|document\./);
});
