import assert from 'node:assert/strict';
import test from 'node:test';

import handler from '../../api/withdrawal-request.ts';
import type { ApiRequest, ApiResponse } from '../../server/commerce/commerce.ts';

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

const headers = () => ({ origin: 'http://localhost:5173', 'content-type': 'application/json', 'x-vercel-forwarded-for': '203.0.113.9' });
const payload = (extra: Record<string, unknown> = {}) => ({
  customerName: 'Cliente Local', customerEmail: 'cliente@example.test', customerPhone: '',
  orderReference: 'RHB-202610-000123', message: 'Solicitud de prueba', ...extra,
});

async function withSecret(run: () => Promise<void>) {
  const before = process.env.COMMERCE_RATE_LIMIT_HASH_SECRET;
  process.env.COMMERCE_RATE_LIMIT_HASH_SECRET = 'withdrawal-test-secret';
  try { await run(); } finally {
    if (before === undefined) delete process.env.COMMERCE_RATE_LIMIT_HASH_SECRET;
    else process.env.COMMERCE_RATE_LIMIT_HASH_SECRET = before;
  }
}

test('creates through the dedicated service-role RPC and exposes only the public code', () => withSecret(async () => {
  let call: { name: string; params: Record<string, unknown> } | null = null;
  const deps = { serviceClient: () => ({ rpc: async (name: string, params: Record<string, unknown>) => {
    call = { name, params };
    return { data: { id: 'private-uuid', customer_email: 'private@example.test', request_code: 'ARR-20261019-A1B2C3D4' }, error: null };
  } }) } as never;
  const result = mockResponse();
  await handler({ method: 'POST', headers: headers(), body: payload() }, result.response, deps);
  assert.equal(result.read().statusCode, 200);
  assert.deepEqual(result.read().body, { ok: true, requestCode: 'ARR-20261019-A1B2C3D4' });
  assert.equal(call?.name, 'public_create_withdrawal_request');
  assert.deepEqual(Object.keys(call!.params).sort(), [
    'p_customer_email', 'p_customer_name', 'p_customer_phone', 'p_message',
    'p_order_reference', 'p_rate_limit_subject_hash', 'p_request_id',
  ].sort());
  assert.doesNotMatch(JSON.stringify(result.read().body), /private-uuid|private@example/);
}));

test('requires no Authorization header and never sends raw IP to the RPC', () => withSecret(async () => {
  let params: Record<string, unknown> = {};
  const deps = { serviceClient: () => ({ rpc: async (_name: string, value: Record<string, unknown>) => {
    params = value;
    return { data: { request_code: 'ARR-20261019-0011AABB' }, error: null };
  } }) } as never;
  const result = mockResponse();
  await handler({ method: 'POST', headers: headers(), body: payload() }, result.response, deps);
  assert.equal(result.read().statusCode, 200);
  assert.match(String(params.p_rate_limit_subject_hash), /^[a-f0-9]{64}$/);
  assert.doesNotMatch(JSON.stringify(params), /203\.0\.113\.9/);
}));

test('handles validation, method, unavailable service, rate limit and malformed RPC response safely', async () => {
  const invalid = mockResponse();
  await handler({ method: 'POST', headers: headers(), body: payload({ orderReference: '' }) }, invalid.response);
  assert.equal(invalid.read().statusCode, 400);

  const method = mockResponse();
  await handler({ method: 'GET', headers: headers() }, method.response);
  assert.equal(method.read().statusCode, 405);

  await withSecret(async () => {
    const unavailable = mockResponse();
    await handler({ method: 'POST', headers: headers(), body: payload() }, unavailable.response, { serviceClient: () => null } as never);
    assert.equal(unavailable.read().statusCode, 503);

    const limited = mockResponse();
    await handler({ method: 'POST', headers: headers(), body: payload() }, limited.response, {
      serviceClient: () => ({ rpc: async () => ({ data: null, error: { code: 'ADM29', details: '42' } }) }),
    } as never);
    assert.equal(limited.read().statusCode, 429);
    assert.equal(limited.read().headers.get('Retry-After'), '42');

    const malformed = mockResponse();
    await handler({ method: 'POST', headers: headers(), body: payload() }, malformed.response, {
      serviceClient: () => ({ rpc: async () => ({ data: { request_code: 'bad' }, error: null }) }),
    } as never);
    assert.equal(malformed.read().statusCode, 500);
  });
});

test('logs no submitted personal data', () => withSecret(async () => {
  const logs: unknown[] = [];
  const original = console.info;
  console.info = (...args: unknown[]) => { logs.push(args); };
  try {
    await handler({ method: 'POST', headers: headers(), body: payload() }, mockResponse().response, {
      serviceClient: () => ({ rpc: async () => ({ data: { request_code: 'ARR-20261019-A1B2C3D4' }, error: null }) }),
    } as never);
  } finally { console.info = original; }
  const serialized = JSON.stringify(logs);
  for (const value of ['Cliente Local', 'cliente@example.test', 'RHB-202610-000123', 'Solicitud de prueba']) assert.doesNotMatch(serialized, new RegExp(value));
}));
