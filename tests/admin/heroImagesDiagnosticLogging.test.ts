import assert from 'node:assert/strict';
import test from 'node:test';

import { createAdminSyncHeroImagesHandler } from '../../server/admin/handlers/settings';
import type { AdminAuthClient, AdminAuthUser, AdminRpcClient, AdminRpcError, RequireAdminDependencies } from '../../server/admin/requireAdmin';
import type { ApiRequest, ApiResponse } from '../../server/commerce/commerce';

function mockResponse() {
  let statusCode = 0;
  let body: unknown;
  const response: ApiResponse = {
    status(code) {
      statusCode = code;
      return response;
    },
    json(value) {
      body = value;
    },
    end() {},
    setHeader() {},
  };
  return { response, read: () => ({ statusCode, body }) };
}

const ADMIN_ID = '11111111-1111-4111-8111-111111111111';

function jsonRequest(body: unknown): ApiRequest {
  return {
    method: 'POST',
    headers: { origin: 'http://localhost:5173', 'content-type': 'application/json', authorization: 'Bearer valid-token' },
    body,
  };
}

function fakeAuthClient(): AdminAuthClient {
  return {
    auth: {
      async getUser() {
        const user: AdminAuthUser = { id: ADMIN_ID };
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
          return { data: { role: 'admin' }, error: null };
        },
      };
    },
  };
}

function fakeRpcClient(response: { data: unknown; error: AdminRpcError | null }): AdminRpcClient {
  return { rpc: async () => response };
}

function deps(overrides: Partial<RequireAdminDependencies>): Partial<RequireAdminDependencies> {
  return overrides;
}

const VALID_BODY = { images: [{ legacyUrl: 'https://images.example.test/legacy.jpg', alt: '', enabled: true }] };

// --- capture console.info without ever letting a real log call escape unobserved ---

async function captured(run: () => Promise<void>): Promise<unknown[][]> {
  const calls: unknown[][] = [];
  const original = console.info;
  console.info = (...args: unknown[]) => {
    calls.push(args);
  };
  try {
    await run();
  } finally {
    console.info = original;
  }
  return calls;
}

test('on an RPC failure, the server log includes the raw dbCode/dbMessage/dbDetails/dbHint/status/requestId', async () => {
  const handler = createAdminSyncHeroImagesHandler(
    deps({
      authClient: () => fakeAuthClient(),
      userScopedClient: () =>
        fakeRpcClient({ data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint "idx_hero_images_asset_unique"', details: 'Key (media_asset_id)=(...) already exists.', hint: null } }),
    }),
  );
  const result = mockResponse();

  const calls = await captured(() => handler(jsonRequest(VALID_BODY), result.response));

  const logged = calls.find((args) => args[0] === '[commerce]' && (args[1] as { code?: string })?.code === 'admin_hero_images_update_failed');
  assert.ok(logged, 'expected an admin_hero_images_update_failed log line');
  const context = logged![1] as Record<string, unknown>;
  assert.equal(context.dbCode, '23505');
  assert.match(String(context.dbMessage), /unique constraint/);
  assert.match(String(context.dbDetails), /already exists/);
  assert.equal(context.status, 500);
  assert.equal(typeof context.requestId, 'string');
});

test('the public response never contains the internal dbCode/dbMessage/dbDetails/dbHint -- only the sanitized, generic error', async () => {
  const handler = createAdminSyncHeroImagesHandler(
    deps({
      authClient: () => fakeAuthClient(),
      userScopedClient: () => fakeRpcClient({ data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint "idx_hero_images_asset_unique"', details: 'Key (media_asset_id)=(secret-looking-id) already exists.', hint: 'Check the asset id.' } }),
    }),
  );
  const result = mockResponse();

  await captured(() => handler(jsonRequest(VALID_BODY), result.response));

  const { statusCode, body } = result.read();
  assert.equal(statusCode, 500);
  const serializedBody = JSON.stringify(body);
  assert.doesNotMatch(serializedBody, /23505/);
  assert.doesNotMatch(serializedBody, /unique constraint/);
  assert.doesNotMatch(serializedBody, /secret-looking-id/);
  assert.doesNotMatch(serializedBody, /Check the asset id/);
  assert.deepEqual(body, { error: 'No disponible.', requestId: (body as { requestId: string }).requestId });
});

test('status mapping is unchanged: a recognized ADM code still maps to its documented HTTP status (403 for ADM03)', async () => {
  const handler = createAdminSyncHeroImagesHandler(
    deps({ authClient: () => fakeAuthClient(), userScopedClient: () => fakeRpcClient({ data: null, error: { code: 'ADM03', message: 'forbidden' } }) }),
  );
  const result = mockResponse();

  await captured(() => handler(jsonRequest(VALID_BODY), result.response));

  assert.equal(result.read().statusCode, 403);
});

test('a successful sync (no error) never logs admin_hero_images_update_failed, and the response is unaffected', async () => {
  const handler = createAdminSyncHeroImagesHandler(
    deps({ authClient: () => fakeAuthClient(), userScopedClient: () => fakeRpcClient({ data: [{ id: 'x', mediaAssetId: null, url: 'https://images.example.test/legacy.jpg', alt: null, enabled: true }], error: null }) }),
  );
  const result = mockResponse();

  const calls = await captured(() => handler(jsonRequest(VALID_BODY), result.response));

  assert.ok(!calls.some((args) => (args[1] as { code?: string })?.code === 'admin_hero_images_update_failed'));
  assert.equal(result.read().statusCode, 200);
});
