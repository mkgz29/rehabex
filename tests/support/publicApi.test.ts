import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

import { PublicApiError, submitSupportRequest } from '../../src/services/publicApi.ts';

function withFetch(impl: typeof fetch, run: () => Promise<void>) {
  const original = globalThis.fetch;
  globalThis.fetch = impl;
  return run().finally(() => {
    globalThis.fetch = original;
  });
}

const validInput = {
  customerName: 'Cliente Web',
  customerEmail: 'cliente@example.test',
  customerPhone: '+54 9 11 1234-5678',
  topic: 'shipping' as const,
  subject: 'Mi pedido no llego',
  orderReference: 'RHB-202610-000099',
  message: 'Hola, todavia no me llego mi pedido.',
  formGuard: '',
};

test('submitSupportRequest POSTs to /api/support-intake with exactly the given payload as JSON', () =>
  withFetch(async (input, init) => {
    assert.equal(input, '/api/support-intake');
    assert.equal(init?.method, 'POST');
    assert.equal((init?.headers as Record<string, string>)['Content-Type'], 'application/json');
    assert.deepEqual(JSON.parse(init?.body as string), validInput);
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  }, async () => {
    await submitSupportRequest(validInput);
  }));

test('submitSupportRequest never calls Supabase or imports a service-role concept -- it is a plain fetch', () => {
  const content = readFileSync(join(process.cwd(), 'src/services/publicApi.ts'), 'utf8');
  // Check actual code patterns, not prose: this file's own comments
  // legitimately explain *why* it must avoid Supabase, which would otherwise
  // false-positive a bare substring check against the word itself.
  assert.doesNotMatch(content, /from ['"]@supabase|createClient|\.rpc\(|SUPABASE_SERVICE_ROLE_KEY/);
});

test('a non-ok response throws PublicApiError carrying the real HTTP status', () =>
  withFetch(async () => new Response(JSON.stringify({ error: 'Solicitud invalida.' }), { status: 400 }), async () => {
    await assert.rejects(
      () => submitSupportRequest(validInput),
      (error: unknown) => error instanceof PublicApiError && error.status === 400,
    );
  }));

test('a 429 response throws PublicApiError with status 429', () =>
  withFetch(async () => new Response(JSON.stringify({ error: 'Demasiadas solicitudes.' }), { status: 429 }), async () => {
    await assert.rejects(
      () => submitSupportRequest(validInput),
      (error: unknown) => error instanceof PublicApiError && error.status === 429,
    );
  }));

test('a network failure throws PublicApiError with status 0, never crashes the caller', () =>
  withFetch(async () => { throw new TypeError('network error'); }, async () => {
    await assert.rejects(
      () => submitSupportRequest(validInput),
      (error: unknown) => error instanceof PublicApiError && error.status === 0,
    );
  }));

test('a successful response resolves without throwing', () =>
  withFetch(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }), async () => {
    await assert.doesNotReject(() => submitSupportRequest(validInput));
  }));
