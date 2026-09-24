import assert from 'node:assert/strict';
import test from 'node:test';

import { createAdminCreateProductHandler, createAdminSetProductActiveHandler, createAdminUpdateProductHandler } from '../../server/admin/handlers/products';
import { createAdminAboutSettingsHandler, createAdminHeroSettingsHandler } from '../../server/admin/handlers/settings';
import type { AdminAuthClient, AdminAuthUser, AdminRpcClient, RequireAdminDependencies } from '../../server/admin/requireAdmin';
import type { ApiRequest, ApiResponse } from '../../server/commerce/commerce';

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

const ADMIN_ID = '11111111-1111-4111-8111-111111111111';
const PRODUCT_ID = '22222222-2222-4222-8222-222222222222';
const NOW = new Date().toISOString();

function jsonRequest(body: unknown, headers: Record<string, string> = {}): ApiRequest {
  return {
    method: 'POST',
    headers: {
      origin: 'http://localhost:5173',
      'content-type': 'application/json',
      authorization: 'Bearer valid-token',
      ...headers,
    },
    body,
  };
}

function fakeAuthClient(options: { noUser?: boolean; role?: string | null; profileError?: boolean; asServiceRole?: boolean } = {}): AdminAuthClient {
  return {
    auth: {
      async getUser() {
        if (options.noUser) return { data: { user: null }, error: { message: 'invalid token' } };
        const user: AdminAuthUser = { id: ADMIN_ID, ...(options.asServiceRole ? { role: 'service_role' } : {}) };
        return { data: { user }, error: null };
      },
    },
    from() {
      return {
        select() {
          return this;
        },
        eq() {
          return this;
        },
        async maybeSingle() {
          if (options.profileError) return { data: null, error: { message: 'db error' } };
          if (options.role === null) return { data: null, error: null };
          return { data: { role: options.role ?? 'admin' }, error: null };
        },
      };
    },
  };
}

function fakeRpcClient(response: { data: unknown; error: { code?: string; message?: string } | null }): AdminRpcClient {
  return { rpc: async () => response };
}

function productRow(overrides: Record<string, unknown> = {}) {
  return {
    id: PRODUCT_ID,
    name: 'Producto de prueba',
    description: '',
    category: 'Ortopedia',
    price: 100,
    image_url: null,
    is_featured: false,
    display_order: 0,
    is_active: false,
    created_at: NOW,
    updated_at: NOW,
    ...overrides,
  };
}

function settingsRow(value: unknown, overrides: Record<string, unknown> = {}) {
  return { key: 'hero_content', value, updated_at: NOW, ...overrides };
}

function deps(overrides: Partial<RequireAdminDependencies>): Partial<RequireAdminDependencies> {
  return overrides;
}

const VALID_CREATE_BODY = {
  name: 'Producto de prueba',
  description: '',
  category: 'Ortopedia',
  price: 100,
  imageUrl: null,
  isFeatured: false,
  displayOrder: 0,
};

const VALID_UPDATE_BODY = {
  ...VALID_CREATE_BODY,
  id: PRODUCT_ID,
  expectedUpdatedAt: NOW,
};

const VALID_SET_ACTIVE_BODY = { id: PRODUCT_ID, isActive: true, expectedUpdatedAt: NOW };

const VALID_HERO_VALUE = {
  title: 'Titulo',
  subtitle: '',
  image_url: 'https://images.example.test/hero.jpg',
  primary_cta_text: 'Ver mas',
  primary_cta_link: '/tienda',
};

const VALID_ABOUT_VALUE = {
  image: 'https://images.example.test/about.jpg',
  title: 'Titulo',
  description: 'Descripcion',
  metrics: [{ id: 'metric-1', value: '+500', label: 'texto' }],
};

// --- Shared boundary behaviour, exercised through the create-product endpoint ---

test('admin boundary: rejects a non-POST method with 405', async () => {
  const handler = createAdminCreateProductHandler();
  const result = mockResponse();
  await handler({ method: 'GET', headers: {} }, result.response);
  assert.equal(result.read().statusCode, 405);
});

test('admin boundary: rejects a disallowed origin with 403', async () => {
  const handler = createAdminCreateProductHandler();
  const result = mockResponse();
  await handler({ method: 'POST', headers: { origin: 'https://attacker.invalid' }, body: VALID_CREATE_BODY }, result.response);
  assert.equal(result.read().statusCode, 403);
});

test('admin boundary: rejects a non-JSON content type with 415', async () => {
  const handler = createAdminCreateProductHandler();
  const result = mockResponse();
  await handler(jsonRequest(VALID_CREATE_BODY, { 'content-type': 'text/plain' }), result.response);
  assert.equal(result.read().statusCode, 415);
});

test('admin boundary: rejects an oversized body with 413', async () => {
  const handler = createAdminCreateProductHandler();
  const result = mockResponse();
  const request = jsonRequest(VALID_CREATE_BODY, { 'content-length': String(64 * 1024) });
  await handler(request, result.response);
  assert.equal(result.read().statusCode, 413);
});

test('admin boundary: rejects a missing Authorization header with 401', async () => {
  const handler = createAdminCreateProductHandler();
  const result = mockResponse();
  const request = jsonRequest(VALID_CREATE_BODY);
  delete request.headers!.authorization;
  await handler(request, result.response);
  assert.equal(result.read().statusCode, 401);
});

test('admin boundary: rejects a malformed Authorization header with 401', async () => {
  const handler = createAdminCreateProductHandler();
  const result = mockResponse();
  await handler(jsonRequest(VALID_CREATE_BODY, { authorization: 'Token abc' }), result.response);
  assert.equal(result.read().statusCode, 401);
});

test('admin boundary: rejects an invalid or expired token with 401 and never echoes it', async () => {
  const handler = createAdminCreateProductHandler(deps({ authClient: () => fakeAuthClient({ noUser: true }) }));
  const result = mockResponse();
  await handler(jsonRequest(VALID_CREATE_BODY), result.response);
  const { statusCode, body } = result.read();
  assert.equal(statusCode, 401);
  assert.doesNotMatch(JSON.stringify(body), /valid-token/);
});

test('admin boundary: a service_role token is never accepted as a user session', async () => {
  const handler = createAdminCreateProductHandler(deps({ authClient: () => fakeAuthClient({ asServiceRole: true }) }));
  const result = mockResponse();
  await handler(jsonRequest(VALID_CREATE_BODY), result.response);
  assert.equal(result.read().statusCode, 401);
});

test('admin boundary: an authenticated non-admin is rejected with 403', async () => {
  const handler = createAdminCreateProductHandler(deps({ authClient: () => fakeAuthClient({ role: 'customer' }) }));
  const result = mockResponse();
  await handler(jsonRequest(VALID_CREATE_BODY), result.response);
  assert.equal(result.read().statusCode, 403);
});

test('admin boundary: a user with no profile row is rejected with 403', async () => {
  const handler = createAdminCreateProductHandler(deps({ authClient: () => fakeAuthClient({ role: null }) }));
  const result = mockResponse();
  await handler(jsonRequest(VALID_CREATE_BODY), result.response);
  assert.equal(result.read().statusCode, 403);
});

test('admin boundary: a profile lookup failure returns a sanitized 500', async () => {
  const handler = createAdminCreateProductHandler(deps({ authClient: () => fakeAuthClient({ profileError: true }) }));
  const result = mockResponse();
  await handler(jsonRequest(VALID_CREATE_BODY), result.response);
  const { statusCode, body } = result.read();
  assert.equal(statusCode, 500);
  assert.doesNotMatch(JSON.stringify(body), /db error/);
});

test('admin boundary: malformed JSON body returns 400', async () => {
  const handler = createAdminCreateProductHandler(deps({ authClient: () => fakeAuthClient(), userScopedClient: () => fakeRpcClient({ data: null, error: { code: 'ADM22' } }) }));
  const result = mockResponse();
  await handler(jsonRequest('{not json', { 'content-length': '9' }), result.response);
  assert.equal(result.read().statusCode, 400);
});

test('admin boundary: OPTIONS answers 204 for an allowed origin without requiring auth', async () => {
  const handler = createAdminCreateProductHandler();
  const result = mockResponse();
  await handler({ method: 'OPTIONS', headers: { origin: 'http://localhost:5173' } }, result.response);
  assert.equal(result.read().statusCode, 204);
});

test('admin boundary: successful responses include a requestId and never a token or session', async () => {
  const handler = createAdminCreateProductHandler(
    deps({ authClient: () => fakeAuthClient(), userScopedClient: () => fakeRpcClient({ data: productRow(), error: null }) }),
  );
  const result = mockResponse();
  await handler(jsonRequest(VALID_CREATE_BODY), result.response);
  const { statusCode, body } = result.read();
  assert.equal(statusCode, 200);
  assert.equal(typeof (body as { requestId?: string }).requestId, 'string');
  assert.doesNotMatch(JSON.stringify(body), /valid-token|access_token|refresh_token/);
});

// --- Product create -----------------------------------------------------------

test('create product: rejects unknown fields, stock, and role with 422', async () => {
  const handler = createAdminCreateProductHandler(deps({ authClient: () => fakeAuthClient(), userScopedClient: () => fakeRpcClient({ data: null, error: { code: 'ADM22' } }) }));
  for (const badBody of [
    { ...VALID_CREATE_BODY, stock_on_hand: 999 },
    { ...VALID_CREATE_BODY, role: 'admin' },
    { ...VALID_CREATE_BODY, id: PRODUCT_ID },
    { ...VALID_CREATE_BODY, price: 'ten' },
    { ...VALID_CREATE_BODY, price: Number.NaN },
    { ...VALID_CREATE_BODY, price: Number.POSITIVE_INFINITY },
    { ...VALID_CREATE_BODY, price: -5 },
    { ...VALID_CREATE_BODY, category: 'TEST' },
    { ...VALID_CREATE_BODY, name: '' },
    { ...VALID_CREATE_BODY, imageUrl: 'javascript:alert(1)' },
  ]) {
    const result = mockResponse();
    await handler(jsonRequest(badBody), result.response);
    assert.equal(result.read().statusCode, 422, `expected 422 for ${JSON.stringify(badBody)}`);
  }
});

test('create product: a valid admin request creates an inactive product', async () => {
  const handler = createAdminCreateProductHandler(
    deps({ authClient: () => fakeAuthClient(), userScopedClient: () => fakeRpcClient({ data: productRow({ is_active: false }), error: null }) }),
  );
  const result = mockResponse();
  await handler(jsonRequest(VALID_CREATE_BODY), result.response);
  const { statusCode, body } = result.read();
  assert.equal(statusCode, 200);
  assert.equal((body as { product: { active: boolean } }).product.active, false);
});

test('create product: a reserved-category rejection from the RPC maps to 422', async () => {
  const handler = createAdminCreateProductHandler(
    deps({ authClient: () => fakeAuthClient(), userScopedClient: () => fakeRpcClient({ data: null, error: { code: 'ADM22' } }) }),
  );
  const result = mockResponse();
  await handler(jsonRequest(VALID_CREATE_BODY), result.response);
  assert.equal(result.read().statusCode, 422);
});

// --- Product update -------------------------------------------------------------

test('update product: rejects unknown fields and a missing version with 422', async () => {
  const handler = createAdminUpdateProductHandler(deps({ authClient: () => fakeAuthClient(), userScopedClient: () => fakeRpcClient({ data: null, error: { code: 'ADM22' } }) }));
  for (const badBody of [
    { ...VALID_UPDATE_BODY, updated_at: NOW },
    { ...VALID_UPDATE_BODY, expectedUpdatedAt: undefined },
    { ...VALID_UPDATE_BODY, id: 'not-a-uuid' },
    { ...VALID_UPDATE_BODY, created_by: ADMIN_ID },
  ]) {
    const result = mockResponse();
    await handler(jsonRequest(badBody), result.response);
    assert.equal(result.read().statusCode, 422, `expected 422 for ${JSON.stringify(badBody)}`);
  }
});

test('update product: a version conflict from the RPC maps to 409', async () => {
  const handler = createAdminUpdateProductHandler(
    deps({ authClient: () => fakeAuthClient(), userScopedClient: () => fakeRpcClient({ data: null, error: { code: 'ADM09' } }) }),
  );
  const result = mockResponse();
  await handler(jsonRequest(VALID_UPDATE_BODY), result.response);
  assert.equal(result.read().statusCode, 409);
});

test('update product: an unknown product id maps to 404', async () => {
  const handler = createAdminUpdateProductHandler(
    deps({ authClient: () => fakeAuthClient(), userScopedClient: () => fakeRpcClient({ data: null, error: { code: 'ADM04' } }) }),
  );
  const result = mockResponse();
  await handler(jsonRequest(VALID_UPDATE_BODY), result.response);
  assert.equal(result.read().statusCode, 404);
});

test('update product: an unmapped internal error is sanitized to 500', async () => {
  const handler = createAdminUpdateProductHandler(
    deps({ authClient: () => fakeAuthClient(), userScopedClient: () => fakeRpcClient({ data: null, error: { code: undefined, message: 'internal secret detail' } }) }),
  );
  const result = mockResponse();
  await handler(jsonRequest(VALID_UPDATE_BODY), result.response);
  const { statusCode, body } = result.read();
  assert.equal(statusCode, 500);
  assert.doesNotMatch(JSON.stringify(body), /internal secret detail/);
});

test('update product: a valid admin request succeeds', async () => {
  const handler = createAdminUpdateProductHandler(
    deps({ authClient: () => fakeAuthClient(), userScopedClient: () => fakeRpcClient({ data: productRow({ name: 'Actualizado' }), error: null }) }),
  );
  const result = mockResponse();
  await handler(jsonRequest(VALID_UPDATE_BODY), result.response);
  const { statusCode, body } = result.read();
  assert.equal(statusCode, 200);
  assert.equal((body as { product: { name: string } }).product.name, 'Actualizado');
});

// --- Product set-active ----------------------------------------------------------

test('set-active: rejects an authenticated non-admin with 403 and never mutates', async () => {
  let called = false;
  const handler = createAdminSetProductActiveHandler(
    deps({
      authClient: () => fakeAuthClient({ role: 'customer' }),
      userScopedClient: () => ({ rpc: async () => { called = true; return { data: null, error: null }; } }),
    }),
  );
  const result = mockResponse();
  await handler(jsonRequest(VALID_SET_ACTIVE_BODY), result.response);
  assert.equal(result.read().statusCode, 403);
  assert.equal(called, false);
});

test('set-active: rejects a non-boolean isActive with 422', async () => {
  const handler = createAdminSetProductActiveHandler(deps({ authClient: () => fakeAuthClient(), userScopedClient: () => fakeRpcClient({ data: null, error: { code: 'ADM22' } }) }));
  const result = mockResponse();
  await handler(jsonRequest({ ...VALID_SET_ACTIVE_BODY, isActive: 'true' }), result.response);
  assert.equal(result.read().statusCode, 422);
});

test('set-active: a valid admin request activates or deactivates', async () => {
  const handler = createAdminSetProductActiveHandler(
    deps({ authClient: () => fakeAuthClient(), userScopedClient: () => fakeRpcClient({ data: productRow({ is_active: true }), error: null }) }),
  );
  const result = mockResponse();
  await handler(jsonRequest(VALID_SET_ACTIVE_BODY), result.response);
  const { statusCode, body } = result.read();
  assert.equal(statusCode, 200);
  assert.equal((body as { product: { active: boolean } }).product.active, true);
});

// --- Settings: hero / about --------------------------------------------------------

test('hero settings: rejects an unknown field and an unsafe CTA link with 422', async () => {
  const handler = createAdminHeroSettingsHandler(deps({ authClient: () => fakeAuthClient(), userScopedClient: () => fakeRpcClient({ data: null, error: { code: 'ADM22' } }) }));
  for (const badBody of [
    { value: { ...VALID_HERO_VALUE, settings_key: 'commerce_shipping' }, expectedUpdatedAt: NOW },
    { value: { ...VALID_HERO_VALUE, primary_cta_link: 'javascript:alert(1)' }, expectedUpdatedAt: NOW },
    { value: { ...VALID_HERO_VALUE, image_url: 'http://images.example.test/hero.jpg' }, expectedUpdatedAt: NOW },
    { value: { ...VALID_HERO_VALUE, title: '<script>' }, expectedUpdatedAt: NOW },
  ]) {
    const result = mockResponse();
    await handler(jsonRequest(badBody), result.response);
    assert.equal(result.read().statusCode, 422, `expected 422 for ${JSON.stringify(badBody)}`);
  }
});

test('hero settings: a valid save succeeds and returns the stored value', async () => {
  const handler = createAdminHeroSettingsHandler(
    deps({ authClient: () => fakeAuthClient(), userScopedClient: () => fakeRpcClient({ data: settingsRow(VALID_HERO_VALUE), error: null }) }),
  );
  const result = mockResponse();
  await handler(jsonRequest({ value: VALID_HERO_VALUE, expectedUpdatedAt: NOW }), result.response);
  const { statusCode, body } = result.read();
  assert.equal(statusCode, 200);
  assert.equal((body as { setting: { value: typeof VALID_HERO_VALUE } }).setting.value.title, VALID_HERO_VALUE.title);
});

test('hero settings: a null expectedUpdatedAt is accepted for a first-ever save', async () => {
  const handler = createAdminHeroSettingsHandler(
    deps({ authClient: () => fakeAuthClient(), userScopedClient: () => fakeRpcClient({ data: settingsRow(VALID_HERO_VALUE), error: null }) }),
  );
  const result = mockResponse();
  await handler(jsonRequest({ value: VALID_HERO_VALUE, expectedUpdatedAt: null }), result.response);
  assert.equal(result.read().statusCode, 200);
});

test('about settings: rejects too many metrics and an unknown metric field with 422', async () => {
  const handler = createAdminAboutSettingsHandler(deps({ authClient: () => fakeAuthClient(), userScopedClient: () => fakeRpcClient({ data: null, error: { code: 'ADM22' } }) }));
  const tooManyMetrics = { ...VALID_ABOUT_VALUE, metrics: Array.from({ length: 7 }, (_, index) => ({ id: `metric-${index}`, value: 'x', label: 'y' })) };
  const badMetricField = { ...VALID_ABOUT_VALUE, metrics: [{ id: 'metric-1', value: 'x', label: 'y', extra: true }] };
  for (const badBody of [
    { value: tooManyMetrics, expectedUpdatedAt: NOW },
    { value: badMetricField, expectedUpdatedAt: NOW },
    { value: { ...VALID_ABOUT_VALUE, image: '' }, expectedUpdatedAt: NOW },
  ]) {
    const result = mockResponse();
    await handler(jsonRequest(badBody), result.response);
    assert.equal(result.read().statusCode, 422, `expected 422 for ${JSON.stringify(badBody)}`);
  }
});

test('about settings: a valid save succeeds', async () => {
  const handler = createAdminAboutSettingsHandler(
    deps({ authClient: () => fakeAuthClient(), userScopedClient: () => fakeRpcClient({ data: settingsRow(VALID_ABOUT_VALUE, { key: 'about_content' }), error: null }) }),
  );
  const result = mockResponse();
  await handler(jsonRequest({ value: VALID_ABOUT_VALUE, expectedUpdatedAt: NOW }), result.response);
  assert.equal(result.read().statusCode, 200);
});

test('about settings: a version conflict maps to 409 with a clear, non-technical message', async () => {
  const handler = createAdminAboutSettingsHandler(
    deps({ authClient: () => fakeAuthClient(), userScopedClient: () => fakeRpcClient({ data: null, error: { code: 'ADM09' } }) }),
  );
  const result = mockResponse();
  await handler(jsonRequest({ value: VALID_ABOUT_VALUE, expectedUpdatedAt: NOW }), result.response);
  const { statusCode, body } = result.read();
  assert.equal(statusCode, 409);
  assert.doesNotMatch(JSON.stringify(body), /SQL|policy|stack|ADM09/);
});
