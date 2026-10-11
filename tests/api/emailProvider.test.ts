import assert from 'node:assert/strict';
import test from 'node:test';

import { loadEmailProviderConfig, sendTransactionalEmail } from '../../server/commerce/emailProvider.js';

const ORIGINAL_ENV = { ...process.env };

function resetEnv() {
  for (const key of Object.keys(process.env)) {
    if (!(key in ORIGINAL_ENV)) delete process.env[key];
  }
  Object.assign(process.env, ORIGINAL_ENV);
}

function withFetch(mock: typeof fetch, run: () => Promise<void> | void) {
  const original = globalThis.fetch;
  globalThis.fetch = mock;
  return Promise.resolve(run()).finally(() => {
    globalThis.fetch = original;
  });
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

const INPUT = { to: 'cliente@example.test', from: 'Rehabex <compras@rehabex.example>', subject: 'Asunto', html: '<p>x</p>', text: 'x' };

// --- loadEmailProviderConfig ---------------------------------------------------

test('loadEmailProviderConfig: ok when apiKey and a valid from are set, replyTo omitted', () => {
  process.env.EMAIL_PROVIDER_API_KEY = 'secret-key';
  process.env.EMAIL_FROM = 'Rehabex <compras@rehabex.example>';
  delete process.env.EMAIL_REPLY_TO;
  const result = loadEmailProviderConfig();
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.config.apiKey, 'secret-key');
    assert.equal(result.config.from, 'Rehabex <compras@rehabex.example>');
    assert.equal(result.config.replyTo, undefined);
  }
  resetEnv();
});

test('loadEmailProviderConfig: ok with a bare "local@domain" from and a valid replyTo', () => {
  process.env.EMAIL_PROVIDER_API_KEY = 'secret-key';
  process.env.EMAIL_FROM = 'compras@rehabex.example';
  process.env.EMAIL_REPLY_TO = 'soporte@rehabex.example';
  const result = loadEmailProviderConfig();
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.config.replyTo, 'soporte@rehabex.example');
  resetEnv();
});

test('loadEmailProviderConfig: configuration_missing when the API key is absent', () => {
  delete process.env.EMAIL_PROVIDER_API_KEY;
  process.env.EMAIL_FROM = 'compras@rehabex.example';
  const result = loadEmailProviderConfig();
  assert.deepEqual(result, { ok: false, errorCode: 'configuration_missing' });
  resetEnv();
});

test('loadEmailProviderConfig: configuration_missing when EMAIL_FROM is absent or malformed', () => {
  process.env.EMAIL_PROVIDER_API_KEY = 'secret-key';
  delete process.env.EMAIL_FROM;
  assert.equal(loadEmailProviderConfig().ok, false);
  process.env.EMAIL_FROM = 'not-an-email';
  assert.equal(loadEmailProviderConfig().ok, false);
  resetEnv();
});

test('loadEmailProviderConfig: configuration_missing when EMAIL_REPLY_TO is set but malformed', () => {
  process.env.EMAIL_PROVIDER_API_KEY = 'secret-key';
  process.env.EMAIL_FROM = 'compras@rehabex.example';
  process.env.EMAIL_REPLY_TO = 'not-an-email';
  assert.equal(loadEmailProviderConfig().ok, false);
  resetEnv();
});

// --- sendTransactionalEmail ----------------------------------------------------

test('sendTransactionalEmail: a 200/201 response with an id is ok with providerMessageId', async () => {
  await withFetch(
    (async () => jsonResponse(200, { id: 'resend-msg-123' })) as typeof fetch,
    async () => {
      const result = await sendTransactionalEmail('key', INPUT);
      assert.deepEqual(result, { ok: true, providerMessageId: 'resend-msg-123' });
    },
  );
});

test('sendTransactionalEmail: provider 4xx maps to provider_rejected', async () => {
  await withFetch(
    (async () => jsonResponse(422, { message: 'invalid from address' })) as typeof fetch,
    async () => {
      const result = await sendTransactionalEmail('key', INPUT);
      assert.deepEqual(result, { ok: false, errorCode: 'provider_rejected' });
    },
  );
});

test('sendTransactionalEmail: provider 5xx maps to provider_unavailable', async () => {
  await withFetch(
    (async () => jsonResponse(503, { message: 'down' })) as typeof fetch,
    async () => {
      const result = await sendTransactionalEmail('key', INPUT);
      assert.deepEqual(result, { ok: false, errorCode: 'provider_unavailable' });
    },
  );
});

test('sendTransactionalEmail: a network error/timeout maps to provider_unavailable', async () => {
  await withFetch(
    (async () => { throw new Error('fetch failed: network error'); }) as typeof fetch,
    async () => {
      const result = await sendTransactionalEmail('key', INPUT);
      assert.deepEqual(result, { ok: false, errorCode: 'provider_unavailable' });
    },
  );
});

test('sendTransactionalEmail: an AbortError (the 10s timeout firing) maps to provider_unavailable', async () => {
  await withFetch(
    (async () => { throw new DOMException('The operation was aborted.', 'AbortError'); }) as typeof fetch,
    async () => {
      const result = await sendTransactionalEmail('key', INPUT);
      assert.deepEqual(result, { ok: false, errorCode: 'provider_unavailable' });
    },
  );
});

test('sendTransactionalEmail: a 2xx response with no id maps to unexpected_provider_response', async () => {
  await withFetch(
    (async () => jsonResponse(200, { ok: true })) as typeof fetch,
    async () => {
      const result = await sendTransactionalEmail('key', INPUT);
      assert.deepEqual(result, { ok: false, errorCode: 'unexpected_provider_response' });
    },
  );
});

test('sendTransactionalEmail: a non-JSON 2xx response maps to unexpected_provider_response', async () => {
  await withFetch(
    (async () => new Response('not json', { status: 200 })) as typeof fetch,
    async () => {
      const result = await sendTransactionalEmail('key', INPUT);
      assert.deepEqual(result, { ok: false, errorCode: 'unexpected_provider_response' });
    },
  );
});

test('sendTransactionalEmail: rejects a malformed recipient before ever calling fetch', async () => {
  let called = false;
  await withFetch(
    (async () => { called = true; return jsonResponse(200, { id: 'x' }); }) as typeof fetch,
    async () => {
      const result = await sendTransactionalEmail('key', { ...INPUT, to: 'not-an-email' });
      assert.deepEqual(result, { ok: false, errorCode: 'invalid_recipient' });
    },
  );
  assert.equal(called, false);
});

test('sendTransactionalEmail: reply_to is included only when provided, and the request carries the right shape', async () => {
  let capturedBody: any = null;
  let capturedAuth: string | null = null;
  await withFetch(
    (async (_url: string, init?: RequestInit) => {
      capturedBody = JSON.parse(String(init?.body));
      capturedAuth = (init?.headers as Record<string, string>).Authorization;
      return jsonResponse(200, { id: 'msg-1' });
    }) as typeof fetch,
    async () => {
      await sendTransactionalEmail('super-secret-key', { ...INPUT, replyTo: 'soporte@rehabex.example' });
    },
  );
  assert.equal(capturedAuth, 'Bearer super-secret-key');
  assert.equal(capturedBody.reply_to, 'soporte@rehabex.example');
  assert.equal(capturedBody.from, INPUT.from);
  assert.equal(capturedBody.to, INPUT.to);
  assert.equal(capturedBody.subject, INPUT.subject);
});

test('sendTransactionalEmail: reply_to is omitted entirely when not provided', async () => {
  let capturedBody: any = null;
  await withFetch(
    (async (_url: string, init?: RequestInit) => {
      capturedBody = JSON.parse(String(init?.body));
      return jsonResponse(200, { id: 'msg-1' });
    }) as typeof fetch,
    async () => {
      await sendTransactionalEmail('key', INPUT);
    },
  );
  assert.equal('reply_to' in capturedBody, false);
});

// --- security contract ---------------------------------------------------------

test('SECURITY CONTRACT: emailProvider.ts never logs the api key, recipient, body or raw provider response', async () => {
  const originalInfo = console.info;
  const logged: unknown[] = [];
  console.info = (...args: unknown[]) => { logged.push(args); };
  try {
    await withFetch(
      (async () => jsonResponse(422, { message: 'rejected: cliente@example.test is not verified' })) as typeof fetch,
      async () => {
        await sendTransactionalEmail('super-secret-key', INPUT);
      },
    );
  } finally {
    console.info = originalInfo;
  }
  const serialized = JSON.stringify(logged);
  assert.doesNotMatch(serialized, /super-secret-key/);
  assert.doesNotMatch(serialized, /cliente@example\.test/);
});
