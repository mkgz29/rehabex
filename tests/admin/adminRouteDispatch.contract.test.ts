import assert from 'node:assert/strict';
import test from 'node:test';

import dispatch from '../../api/admin/[...path]';
import type { ApiRequest, ApiResponse } from '../../server/commerce/commerce';

// This suite exists specifically because api/admin/[...path].ts replaced
// seven separate Vercel functions (products/create, products/update,
// products/set-active, settings/hero, settings/about, media/sign,
// media/finalize) to stay under the Hobby plan's 12-function limit. It
// proves routing by path segments still reaches a real handler (a 405 for a
// wrong method, never a 404) and that an unrecognized path under
// /api/admin/* gets the same sanitized 404 shape as api/404.ts, for any
// method.

function mockResponse() {
  let statusCode = 0;
  let body: unknown;
  const headers = new Map<string, string | string[]>();
  const response: ApiResponse = {
    status(code) {
      statusCode = code;
      return response;
    },
    json(value) {
      body = value;
    },
    end() {},
    setHeader(name, value) {
      headers.set(name, value);
    },
  };
  return { response, read: () => ({ statusCode, body, headers }) };
}

function requestFor(path: string[], overrides: Partial<ApiRequest> = {}): ApiRequest & { query: { path: string[] } } {
  return {
    method: 'GET',
    headers: { origin: 'http://localhost:5173' },
    query: { path },
    ...overrides,
  };
}

const KNOWN_ROUTES = [
  ['products', 'create'],
  ['products', 'update'],
  ['products', 'set-active'],
  ['settings', 'hero'],
  ['settings', 'about'],
  ['media', 'sign'],
  ['media', 'finalize'],
];

test('dispatch: every known admin route reaches its real handler (405 on GET, not 404)', async () => {
  for (const path of KNOWN_ROUTES) {
    const result = mockResponse();
    await dispatch(requestFor(path), result.response);
    assert.equal(result.read().statusCode, 405, `expected 405 for /${path.join('/')}, a 404 would mean routing broke`);
  }
});

test('dispatch: an unrecognized path under /api/admin/* returns the same sanitized 404 as api/404.ts', async () => {
  for (const path of [['nonexistent'], ['products', 'delete'], ['products'], ['media'], []]) {
    const result = mockResponse();
    await dispatch(requestFor(path, { method: 'POST' }), result.response);
    const { statusCode, body } = result.read();
    assert.equal(statusCode, 404);
    assert.deepEqual(body, { error: 'API no encontrada.' });
  }
});

test('dispatch: OPTIONS on a known route still runs its own CORS preflight (204, not 404/405)', async () => {
  const result = mockResponse();
  await dispatch(requestFor(['products', 'create'], { method: 'OPTIONS' }), result.response);
  assert.equal(result.read().statusCode, 204);
});
