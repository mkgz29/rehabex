import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

import handler from '../../api/support-intake';
import type { ApiRequest, ApiResponse } from '../../server/commerce/commerce';

function mockResponse() {
  let statusCode = 0;
  let body: unknown;
  const headers = new Map<string, string | string[]>();
  const response: ApiResponse = {
    status(code) { statusCode = code; return response; },
    json(value) { body = value; },
    end() {},
    setHeader(name, value) { headers.set(name, value); },
  };
  return { response, read: () => ({ statusCode, body, headers }) };
}

function browserHeaders(extra: Record<string, string> = {}) {
  return { origin: 'http://localhost:5173', 'content-type': 'application/json', 'x-vercel-forwarded-for': '203.0.113.7', ...extra };
}

function validPayload(overrides: Record<string, unknown> = {}) {
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

type FakeRpcResult = { data: unknown; error: { code?: string; details?: string; message?: string } | null };

function fakeServiceClient(result: FakeRpcResult, calls: { count: number; lastName?: string; lastParams?: Record<string, unknown> }) {
  return () => ({
    rpc: async (name: string, params: Record<string, unknown>) => {
      calls.count += 1;
      calls.lastName = name;
      calls.lastParams = params;
      return result;
    },
  });
}

function withRateLimitSecret<T>(run: () => Promise<T> | T): Promise<T> {
  const before = process.env.COMMERCE_RATE_LIMIT_HASH_SECRET;
  process.env.COMMERCE_RATE_LIMIT_HASH_SECRET = 'test-secret-for-support-intake';
  return Promise.resolve(run()).finally(() => {
    if (before === undefined) delete process.env.COMMERCE_RATE_LIMIT_HASH_SECRET;
    else process.env.COMMERCE_RATE_LIMIT_HASH_SECRET = before;
  });
}

const successRow = { id: '11111111-1111-4111-8111-111111111111', status: 'open', source: 'web', topic: 'shipping' };

// --- method / CORS / body shape ---------------------------------------------

test('OPTIONS gets a correct preflight response', async () => {
  const result = mockResponse();
  await handler({ method: 'OPTIONS', headers: browserHeaders() }, result.response);
  assert.equal(result.read().statusCode, 204);
});

test('a non-POST, non-OPTIONS method is rejected with 405 and an Allow header', async () => {
  for (const method of ['GET', 'PUT', 'DELETE', 'PATCH']) {
    const result = mockResponse();
    await handler({ method, headers: browserHeaders() }, result.response);
    const { statusCode, headers } = result.read();
    assert.equal(statusCode, 405, `expected 405 for ${method}`);
    assert.equal(headers.get('Allow'), 'POST, OPTIONS');
  }
});

test('a disallowed or missing Origin is rejected with 403, before anything else runs', async () => {
  const noOrigin = mockResponse();
  await handler({ method: 'POST', headers: { 'content-type': 'application/json' }, body: validPayload() }, noOrigin.response);
  assert.equal(noOrigin.read().statusCode, 403);

  const badOrigin = mockResponse();
  await handler({ method: 'POST', headers: browserHeaders({ origin: 'https://evil.example.test' }), body: validPayload() }, badOrigin.response);
  assert.equal(badOrigin.read().statusCode, 403);
});

test('a non-JSON Content-Type is rejected with 415', async () => {
  const result = mockResponse();
  await handler({ method: 'POST', headers: browserHeaders({ 'content-type': 'text/plain' }), body: validPayload() }, result.response);
  assert.equal(result.read().statusCode, 415);
});

test('an oversized body is rejected with 413, by declared Content-Length and by actual size', async () => {
  const byLength = mockResponse();
  await handler({ method: 'POST', headers: browserHeaders({ 'content-length': String(32 * 1024) }), body: validPayload() }, byLength.response);
  assert.equal(byLength.read().statusCode, 413);

  const byActualSize = mockResponse();
  await handler({ method: 'POST', headers: browserHeaders(), body: { ...validPayload(), message: 'x'.repeat(20 * 1024) } }, byActualSize.response);
  assert.equal(byActualSize.read().statusCode, 413);
});

test('a malformed (non-object) or unparseable payload is rejected with 400', async () => {
  const notAnObject = mockResponse();
  await handler({ method: 'POST', headers: browserHeaders(), body: 'just a string' }, notAnObject.response);
  assert.equal(notAnObject.read().statusCode, 400);

  const invalidField = mockResponse();
  await handler({ method: 'POST', headers: browserHeaders(), body: validPayload({ topic: 'not-a-real-topic' }) }, invalidField.response);
  assert.equal(invalidField.read().statusCode, 400);

  const extraField = mockResponse();
  await handler({ method: 'POST', headers: browserHeaders(), body: validPayload({ status: 'resolved' }) }, extraField.response);
  assert.equal(extraField.read().statusCode, 400);
});

// --- honeypot (FASE 7D.1-E: renamed from "company" to a non-semantic
// "formGuard", since the old name matched browser/password-manager autofill
// heuristics and caused real visitors to false-positive as bots) -----------

test('a filled honeypot (formGuard) returns the exact same success shape, and never calls the RPC', async () => {
  const calls = { count: 0 };
  const deps = { serviceClient: fakeServiceClient({ data: successRow, error: null }, calls) };
  const result = mockResponse();
  await handler(
    { method: 'POST', headers: browserHeaders(), body: validPayload({ formGuard: 'some-autofilled-or-bot-value', customerEmail: 'not-even-valid' }) },
    result.response,
    deps,
  );
  const { statusCode, body } = result.read();
  assert.equal(statusCode, 200);
  assert.deepEqual(body, { ok: true });
  assert.equal(calls.count, 0, 'public_create_support_request must never be called for a honeypot-triggered request');
});

test('the old "company" field name is no longer accepted at all: an otherwise valid payload carrying it is rejected with 400, not treated as the honeypot or silently ignored', async () => {
  const calls = { count: 0 };
  const deps = { serviceClient: fakeServiceClient({ data: successRow, error: null }, calls) };
  const result = mockResponse();
  await handler(
    { method: 'POST', headers: browserHeaders(), body: validPayload({ company: '' }) },
    result.response,
    deps,
  );
  const { statusCode } = result.read();
  assert.equal(statusCode, 400);
  assert.equal(calls.count, 0);
});

// --- success / RPC wiring -----------------------------------------------------

test('a valid submission returns 200 {ok:true} and calls the RPC with exactly the documented 03B parameters', () =>
  withRateLimitSecret(async () => {
    const calls = { count: 0 } as { count: number; lastName?: string; lastParams?: Record<string, unknown> };
    const deps = { serviceClient: fakeServiceClient({ data: successRow, error: null }, calls) };
    const result = mockResponse();
    await handler({ method: 'POST', headers: browserHeaders(), body: validPayload() }, result.response, deps);

    const { statusCode, body } = result.read();
    assert.equal(statusCode, 200);
    assert.deepEqual(body, { ok: true }, 'the public response must never include the full support_requests row');

    assert.equal(calls.count, 1);
    assert.equal(calls.lastName, 'public_create_support_request');
    const params = calls.lastParams!;
    assert.deepEqual(Object.keys(params).sort(), [
      'p_customer_email', 'p_customer_name', 'p_customer_phone', 'p_message', 'p_order_reference',
      'p_rate_limit_subject_hash', 'p_request_id', 'p_subject', 'p_topic',
    ].sort());
    assert.equal(params.p_customer_name, 'Cliente Web');
    assert.equal(params.p_customer_email, 'cliente@example.test');
    assert.equal(params.p_topic, 'shipping');
    assert.equal(params.p_order_reference, 'RHB-202610-000099');
    assert.equal(typeof params.p_request_id, 'string');
    assert.equal(typeof params.p_rate_limit_subject_hash, 'string');
    assert.match(params.p_rate_limit_subject_hash as string, /^[a-f0-9]{64}$/, 'the IP must be hashed, never sent raw');
  }));

test('the client cannot set requestId: a server-generated UUID is used regardless of what the client sends', () =>
  withRateLimitSecret(async () => {
    const calls = { count: 0 } as { count: number; lastParams?: Record<string, unknown> };
    const deps = { serviceClient: fakeServiceClient({ data: successRow, error: null }, calls) };
    const result = mockResponse();
    // requestId is not even an allowed key, so this also exercises the 400 path --
    // a separate call below exercises the happy path to inspect the generated id.
    await handler({ method: 'POST', headers: browserHeaders(), body: validPayload({ requestId: '00000000-0000-0000-0000-000000000000' }) }, result.response, deps);
    assert.equal(result.read().statusCode, 400);
    assert.equal(calls.count, 0);

    const okResult = mockResponse();
    await handler({ method: 'POST', headers: browserHeaders(), body: validPayload() }, okResult.response, deps);
    assert.equal(okResult.read().statusCode, 200);
    assert.notEqual(calls.lastParams!.p_request_id, '00000000-0000-0000-0000-000000000000');
  }));

// --- config / unavailable -----------------------------------------------------

test('a missing serviceClient configuration returns 503, not a crash or a 500', () =>
  withRateLimitSecret(async () => {
    const deps = { serviceClient: (() => null) as never };
    const result = mockResponse();
    await handler({ method: 'POST', headers: browserHeaders(), body: validPayload() }, result.response, deps);
    assert.equal(result.read().statusCode, 503);
  }));

test('a missing rate-limit secret or trusted IP returns 503, never silently skips rate limiting', async () => {
  const before = process.env.COMMERCE_RATE_LIMIT_HASH_SECRET;
  delete process.env.COMMERCE_RATE_LIMIT_HASH_SECRET;
  try {
    const calls = { count: 0 };
    const deps = { serviceClient: fakeServiceClient({ data: successRow, error: null }, calls) };
    const result = mockResponse();
    await handler({ method: 'POST', headers: browserHeaders(), body: validPayload() }, result.response, deps);
    assert.equal(result.read().statusCode, 503);
    assert.equal(calls.count, 0);
  } finally {
    if (before === undefined) delete process.env.COMMERCE_RATE_LIMIT_HASH_SECRET;
    else process.env.COMMERCE_RATE_LIMIT_HASH_SECRET = before;
  }
});

// --- RPC error mapping ---------------------------------------------------------

test('an RPC validation refusal (ADM22) maps to 400 with a generic message', () =>
  withRateLimitSecret(async () => {
    const calls = { count: 0 };
    const deps = { serviceClient: fakeServiceClient({ data: null, error: { code: 'ADM22', message: 'invalid_message' } }, calls) };
    const result = mockResponse();
    await handler({ method: 'POST', headers: browserHeaders(), body: validPayload() }, result.response, deps);
    const { statusCode, body } = result.read();
    assert.equal(statusCode, 400);
    assert.deepEqual(body, { error: 'Solicitud invalida.' });
  }));

test('an unmapped/unexpected RPC error maps to a generic 500, never the raw Postgres message', () =>
  withRateLimitSecret(async () => {
    const calls = { count: 0 };
    const deps = { serviceClient: fakeServiceClient({ data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint "support_requests_pkey"' } }, calls) };
    const result = mockResponse();
    await handler({ method: 'POST', headers: browserHeaders(), body: validPayload() }, result.response, deps);
    const { statusCode, body } = result.read();
    assert.equal(statusCode, 500);
    assert.deepEqual(body, { error: 'No disponible.' });
    assert.doesNotMatch(JSON.stringify(body), /support_requests_pkey|constraint|duplicate key/);
  }));

// --- rate limit (ADM29), surfaced by the RPC itself per 03B's own design ------

test('a rate-limited RPC response (ADM29) maps to 429 with a Retry-After header, never the internal counter', () =>
  withRateLimitSecret(async () => {
    const calls = { count: 0 };
    const deps = { serviceClient: fakeServiceClient({ data: null, error: { code: 'ADM29', details: '37' } }, calls) };
    const result = mockResponse();
    await handler({ method: 'POST', headers: browserHeaders(), body: validPayload() }, result.response, deps);
    const { statusCode, body, headers } = result.read();
    assert.equal(statusCode, 429);
    assert.deepEqual(body, { error: 'Demasiadas solicitudes.' });
    assert.equal(headers.get('Retry-After'), '37');
    assert.doesNotMatch(JSON.stringify(body), /\d/, 'the response body itself must carry no numeric hint of the counter');
  }));

test('a 6th request in the same window is the one the RPC rejects -- exercised here as the RPC returning ADM29 only on the 6th call (the actual 5-per-10-minutes counting is 03B SQL-level behavior, already covered 30/30 in supabase/tests/admin_03b_public_support_intake.sql)', () =>
  withRateLimitSecret(async () => {
    const calls = { count: 0 };
    let n = 0;
    const deps = {
      serviceClient: () => ({
        rpc: async () => {
          n += 1;
          calls.count += 1;
          return n <= 5 ? { data: successRow, error: null } : { data: null, error: { code: 'ADM29', details: '600' } };
        },
      }),
    } as never;
    let lastStatus = 0;
    for (let i = 0; i < 6; i += 1) {
      const result = mockResponse();
      await handler({ method: 'POST', headers: browserHeaders(), body: validPayload() }, result.response, deps);
      lastStatus = result.read().statusCode;
    }
    assert.equal(lastStatus, 429);
    assert.equal(calls.count, 6);
  }));

test('a rate-limit Retry-After value that is missing or non-numeric falls back to a safe default, never crashes', () =>
  withRateLimitSecret(async () => {
    const calls = { count: 0 };
    const deps = { serviceClient: fakeServiceClient({ data: null, error: { code: 'ADM29' } }, calls) };
    const result = mockResponse();
    await handler({ method: 'POST', headers: browserHeaders(), body: validPayload() }, result.response, deps);
    const { statusCode, headers } = result.read();
    assert.equal(statusCode, 429);
    assert.equal(headers.get('Retry-After'), '60');
  }));

// --- logging: no PII --------------------------------------------------------

test('logging on both success and failure never includes customer PII', () =>
  withRateLimitSecret(async () => {
    const logged: unknown[] = [];
    const originalInfo = console.info;
    console.info = (...args: unknown[]) => { logged.push(args); };
    try {
      const calls = { count: 0 };
      const deps = { serviceClient: fakeServiceClient({ data: successRow, error: null }, calls) };
      await handler({ method: 'POST', headers: browserHeaders(), body: validPayload() }, mockResponse().response, deps);

      const failDeps = { serviceClient: fakeServiceClient({ data: null, error: { code: 'ADM22' } }, { count: 0 }) };
      await handler({ method: 'POST', headers: browserHeaders(), body: validPayload() }, mockResponse().response, failDeps);
    } finally {
      console.info = originalInfo;
    }
    const serialized = JSON.stringify(logged);
    for (const pii of ['Cliente Web', 'cliente@example.test', '1234-5678', 'Mi pedido no llego', 'RHB-202610-000099', 'todavia no me llego']) {
      assert.doesNotMatch(serialized, new RegExp(pii.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `log output must not contain "${pii}"`);
    }
  }));

// --- security contract -------------------------------------------------------

test('SECURITY CONTRACT: no file under src/ references the Supabase service-role key', () => {
  const offenders: string[] = [];
  function walk(dir: string) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) { walk(full); continue; }
      if (!/\.(ts|tsx)$/.test(entry.name)) continue;
      const content = readFileSync(full, 'utf8');
      if (/SUPABASE_SERVICE_ROLE_KEY|service_role/.test(content)) offenders.push(full);
    }
  }
  walk(join(process.cwd(), 'src'));
  assert.deepEqual(offenders, [], 'the browser bundle (src/) must never reference the service-role key or role name');
});

test('SECURITY CONTRACT: the endpoint calls serviceClient() itself -- it is not a pass-through that trusts a client-chosen role', () =>
  withRateLimitSecret(async () => {
    // No deps override: the real serviceClient() runs, which returns null
    // without real SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY env vars in this
    // test process -- proving the handler's default path truly calls it
    // (a stub/bypassed path would not 503 here).
    const result = mockResponse();
    await handler({ method: 'POST', headers: browserHeaders(), body: validPayload() }, result.response);
    assert.equal(result.read().statusCode, 503);
  }));
