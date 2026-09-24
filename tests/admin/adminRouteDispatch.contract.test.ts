import assert from 'node:assert/strict';
import test from 'node:test';

import dispatch from '../../api/admin/[category]/[action]';
import type { ApiRequest, ApiResponse } from '../../server/commerce/commerce';

// This suite exists specifically because api/admin/[category]/[action].ts
// replaced seven separate Vercel functions (products/create, products/
// update, products/set-active, settings/hero, settings/about, media/sign,
// media/finalize) to stay under the Hobby plan's 12-function limit. It
// proves dispatch by the two named segments still reaches a real handler (a
// 405 for a wrong method, never a 404) and that an unrecognized
// category/action pair gets the same sanitized 404 shape as api/404.ts, for
// any method. It exercises only this file's own routing table -- whether
// Vercel's compiled build actually delivers requests here at all (the real
// regression class this hotfix addresses) is covered separately by
// tests/admin/vercelRouting.test.ts against the real build output.

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

function requestFor(category: string | undefined, action: string | undefined, overrides: Partial<ApiRequest> = {}): ApiRequest & { query: Record<string, string | undefined> } {
  return {
    method: 'GET',
    headers: { origin: 'http://localhost:5173' },
    query: { category, action },
    ...overrides,
  };
}

const KNOWN_ROUTES: Array<[string, string]> = [
  ['products', 'create'],
  ['products', 'update'],
  ['products', 'set-active'],
  ['settings', 'hero'],
  ['settings', 'about'],
  ['media', 'sign'],
  ['media', 'finalize'],
];

test('dispatch: every known admin route reaches its real handler (405 on GET, not 404)', async () => {
  for (const [category, action] of KNOWN_ROUTES) {
    const result = mockResponse();
    await dispatch(requestFor(category, action), result.response);
    assert.equal(result.read().statusCode, 405, `expected 405 for /${category}/${action}, a 404 would mean routing broke`);
  }
});

test('dispatch: an unrecognized category/action pair returns the same sanitized 404 as api/404.ts', async () => {
  const cases: Array<[string | undefined, string | undefined]> = [
    ['nonexistent', undefined],
    ['products', 'delete'],
    ['products', undefined],
    ['media', undefined],
    [undefined, undefined],
  ];
  for (const [category, action] of cases) {
    const result = mockResponse();
    await dispatch(requestFor(category, action, { method: 'POST' }), result.response);
    const { statusCode, body } = result.read();
    assert.equal(statusCode, 404);
    assert.deepEqual(body, { error: 'API no encontrada.' });
  }
});

test('dispatch: OPTIONS on a known route still runs its own CORS preflight (204, not 404/405)', async () => {
  const result = mockResponse();
  await dispatch(requestFor('products', 'create', { method: 'OPTIONS' }), result.response);
  assert.equal(result.read().statusCode, 204);
});
