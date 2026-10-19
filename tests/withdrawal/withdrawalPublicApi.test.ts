import assert from 'node:assert/strict';
import test from 'node:test';

import { PublicApiError, submitWithdrawalRequest } from '../../src/services/publicApi.ts';

const input = {
  customerName: 'Cliente Local', customerEmail: 'cliente@example.test', customerPhone: '+54 11 5555 5555',
  orderReference: 'RHB-202610-000123', message: 'Comentario', formGuard: '',
};

async function withFetch(implementation: typeof fetch, run: () => Promise<void>) {
  const original = globalThis.fetch;
  globalThis.fetch = implementation;
  try { await run(); } finally { globalThis.fetch = original; }
}

test('posts the exact input to the unauthenticated withdrawal endpoint and returns its code', () => withFetch(async (url, init) => {
  assert.equal(url, '/api/withdrawal-request');
  assert.equal(init?.method, 'POST');
  assert.deepEqual(JSON.parse(String(init?.body)), input);
  assert.equal((init?.headers as Record<string, string>)['Content-Type'], 'application/json');
  assert.equal('Authorization' in (init?.headers as Record<string, string>), false);
  return new Response(JSON.stringify({ ok: true, requestCode: 'ARR-20261019-A1B2C3D4' }), { status: 200 });
}, async () => {
  assert.deepEqual(await submitWithdrawalRequest(input), { requestCode: 'ARR-20261019-A1B2C3D4' });
}));

test('rejects HTTP, network, malformed JSON and invalid-code responses with PublicApiError', async () => {
  await withFetch(async () => new Response('{}', { status: 429 }), async () => {
    await assert.rejects(() => submitWithdrawalRequest(input), (error: unknown) => error instanceof PublicApiError && error.status === 429);
  });
  await withFetch(async () => { throw new TypeError('offline'); }, async () => {
    await assert.rejects(() => submitWithdrawalRequest(input), (error: unknown) => error instanceof PublicApiError && error.status === 0);
  });
  await withFetch(async () => new Response('not json', { status: 200 }), async () => {
    await assert.rejects(() => submitWithdrawalRequest(input), (error: unknown) => error instanceof PublicApiError && error.status === 500);
  });
  await withFetch(async () => new Response(JSON.stringify({ requestCode: 'private-uuid' }), { status: 200 }), async () => {
    await assert.rejects(() => submitWithdrawalRequest(input), (error: unknown) => error instanceof PublicApiError && error.status === 500);
  });
});
