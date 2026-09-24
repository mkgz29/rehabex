import assert from 'node:assert/strict';
import test from 'node:test';

import { createAdminMediaSignHandler, createAdminMediaFinalizeHandler, type SignDependencies, type FinalizeDependencies } from '../../server/admin/handlers/media';
import type { AdminAuthClient, AdminAuthUser, AdminRpcClient } from '../../server/admin/requireAdmin';
import type { CloudinaryEnv } from '../../server/admin/cloudinaryClient';
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
const TEST_ENV: CloudinaryEnv = { cloudName: 'demo', apiKey: 'demo-key', apiSecret: 'demo-secret' };

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

function fakeAuthClient(options: { noUser?: boolean; role?: string | null } = {}): AdminAuthClient {
  return {
    auth: {
      async getUser() {
        if (options.noUser) return { data: { user: null }, error: { message: 'invalid token' } };
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

// --- /api/admin/media/sign ----------------------------------------------------

const VALID_SIGN_BODY = { intent: 'product' };

function signDeps(overrides: Partial<SignDependencies>): Partial<SignDependencies> {
  return {
    authClient: () => fakeAuthClient(),
    userScopedClient: () => fakeRpcClient({ data: { id: 'asset-1' }, error: null }),
    cloudinaryEnv: () => TEST_ENV,
    ...overrides,
  };
}

test('sign: rejects a non-POST method with 405', async () => {
  const handler = createAdminMediaSignHandler();
  const result = mockResponse();
  await handler({ method: 'GET', headers: {} }, result.response);
  assert.equal(result.read().statusCode, 405);
});

test('sign: rejects a missing Authorization header with 401', async () => {
  const handler = createAdminMediaSignHandler(signDeps({}));
  const result = mockResponse();
  const request = jsonRequest(VALID_SIGN_BODY);
  delete request.headers!.authorization;
  await handler(request, result.response);
  assert.equal(result.read().statusCode, 401);
});

test('sign: rejects an authenticated non-admin with 403', async () => {
  const handler = createAdminMediaSignHandler(signDeps({ authClient: () => fakeAuthClient({ role: 'customer' }) }));
  const result = mockResponse();
  await handler(jsonRequest(VALID_SIGN_BODY), result.response);
  assert.equal(result.read().statusCode, 403);
});

test('sign: rejects a disallowed origin with 403', async () => {
  const handler = createAdminMediaSignHandler(signDeps({}));
  const result = mockResponse();
  await handler({ method: 'POST', headers: { origin: 'https://attacker.invalid' }, body: VALID_SIGN_BODY }, result.response);
  assert.equal(result.read().statusCode, 403);
});

test('sign: rejects a non-JSON content type with 415', async () => {
  const handler = createAdminMediaSignHandler(signDeps({}));
  const result = mockResponse();
  await handler(jsonRequest(VALID_SIGN_BODY, { 'content-type': 'text/plain' }), result.response);
  assert.equal(result.read().statusCode, 415);
});

test('sign: rejects an oversized body with 413', async () => {
  const handler = createAdminMediaSignHandler(signDeps({}));
  const result = mockResponse();
  await handler(jsonRequest(VALID_SIGN_BODY, { 'content-length': String(64 * 1024) }), result.response);
  assert.equal(result.read().statusCode, 413);
});

test('sign: rejects an unknown field or an invalid intent with 422', async () => {
  const handler = createAdminMediaSignHandler(signDeps({}));
  for (const body of [{ intent: 'product', folder: 'x' }, { intent: 'gallery' }, {}]) {
    const result = mockResponse();
    await handler(jsonRequest(body), result.response);
    assert.equal(result.read().statusCode, 422, `expected 422 for ${JSON.stringify(body)}`);
  }
});

test('sign: returns 503 without leaking details when Cloudinary is not configured', async () => {
  const handler = createAdminMediaSignHandler(signDeps({ cloudinaryEnv: () => null }));
  const result = mockResponse();
  await handler(jsonRequest(VALID_SIGN_BODY), result.response);
  assert.equal(result.read().statusCode, 503);
});

test('sign: a valid admin request returns signed params scoped to the intent-derived folder, never the api secret', async () => {
  const handler = createAdminMediaSignHandler(
    signDeps({ userScopedClient: () => fakeRpcClient({ data: { id: 'asset-1' }, error: null }) }),
  );
  const result = mockResponse();
  await handler(jsonRequest({ intent: 'hero' }), result.response);
  const { statusCode, body } = result.read();
  assert.equal(statusCode, 200);
  const payload = body as Record<string, unknown>;
  assert.equal(payload.folder, 'rehabex/hero');
  assert.equal(payload.cloudName, TEST_ENV.cloudName);
  assert.equal(payload.apiKey, TEST_ENV.apiKey);
  assert.equal(typeof payload.signature, 'string');
  assert.equal(typeof payload.requestId, 'string');
  assert.doesNotMatch(JSON.stringify(payload), new RegExp(TEST_ENV.apiSecret));
});

test('sign: an RPC failure maps to a sanitized error and never leaks the api secret', async () => {
  const handler = createAdminMediaSignHandler(
    signDeps({ userScopedClient: () => fakeRpcClient({ data: null, error: { code: 'ADM03' } }) }),
  );
  const result = mockResponse();
  await handler(jsonRequest(VALID_SIGN_BODY), result.response);
  const { statusCode, body } = result.read();
  assert.equal(statusCode, 403);
  assert.doesNotMatch(JSON.stringify(body), new RegExp(TEST_ENV.apiSecret));
});

// --- /api/admin/media/finalize -------------------------------------------------

const VALID_FINALIZE_BODY = { publicId: 'a1b2c3d4-e5f6-4789-a0b1-c2d3e4f5a6b7', version: 1700000000, signature: 'a'.repeat(40) };
const VALID_RESOURCE = { format: 'jpg', resource_type: 'image', bytes: 250000, width: 1200, height: 900, secure_url: 'https://res.cloudinary.com/demo/image/upload/v1700000000/x.jpg' };

function finalizeDeps(overrides: Partial<FinalizeDependencies>): Partial<FinalizeDependencies> {
  return {
    authClient: () => fakeAuthClient(),
    userScopedClient: () => fakeRpcClient({ data: null, error: null }),
    cloudinaryEnv: () => TEST_ENV,
    verifyUploadSignature: () => true,
    fetchResourceMetadata: async () => VALID_RESOURCE,
    destroyAsset: async () => ({ ok: true }),
    ...overrides,
  };
}

test('finalize: rejects a non-POST method with 405', async () => {
  const handler = createAdminMediaFinalizeHandler();
  const result = mockResponse();
  await handler({ method: 'GET', headers: {} }, result.response);
  assert.equal(result.read().statusCode, 405);
});

test('finalize: rejects a missing Authorization header with 401', async () => {
  const handler = createAdminMediaFinalizeHandler(finalizeDeps({}));
  const result = mockResponse();
  const request = jsonRequest(VALID_FINALIZE_BODY);
  delete request.headers!.authorization;
  await handler(request, result.response);
  assert.equal(result.read().statusCode, 401);
});

test('finalize: rejects an authenticated non-admin with 403', async () => {
  const handler = createAdminMediaFinalizeHandler(finalizeDeps({ authClient: () => fakeAuthClient({ role: 'customer' }) }));
  const result = mockResponse();
  await handler(jsonRequest(VALID_FINALIZE_BODY), result.response);
  assert.equal(result.read().statusCode, 403);
});

test('finalize: rejects a non-JSON content type with 415', async () => {
  const handler = createAdminMediaFinalizeHandler(finalizeDeps({}));
  const result = mockResponse();
  await handler(jsonRequest(VALID_FINALIZE_BODY, { 'content-type': 'text/plain' }), result.response);
  assert.equal(result.read().statusCode, 415);
});

test('finalize: rejects an oversized body with 413', async () => {
  const handler = createAdminMediaFinalizeHandler(finalizeDeps({}));
  const result = mockResponse();
  await handler(jsonRequest(VALID_FINALIZE_BODY, { 'content-length': String(64 * 1024) }), result.response);
  assert.equal(result.read().statusCode, 413);
});

test('finalize: rejects unknown fields and a malformed public ID with 422', async () => {
  const handler = createAdminMediaFinalizeHandler(finalizeDeps({}));
  for (const body of [
    { ...VALID_FINALIZE_BODY, format: 'jpg' },
    { ...VALID_FINALIZE_BODY, publicId: '../../etc/passwd' },
    { ...VALID_FINALIZE_BODY, signature: 'not-hex' },
  ]) {
    const result = mockResponse();
    await handler(jsonRequest(body), result.response);
    assert.equal(result.read().statusCode, 422, `expected 422 for ${JSON.stringify(body)}`);
  }
});

test('finalize: an altered/invalid signature is rejected without ever calling the Admin API or destroy', async () => {
  let resourceCalled = false;
  let destroyCalled = false;
  const handler = createAdminMediaFinalizeHandler(
    finalizeDeps({
      verifyUploadSignature: () => false,
      fetchResourceMetadata: async () => {
        resourceCalled = true;
        return VALID_RESOURCE;
      },
      destroyAsset: async () => {
        destroyCalled = true;
        return { ok: true };
      },
    }),
  );
  const result = mockResponse();
  await handler(jsonRequest(VALID_FINALIZE_BODY), result.response);
  assert.equal(result.read().statusCode, 422);
  assert.equal(resourceCalled, false);
  assert.equal(destroyCalled, false);
});

test('finalize: a response belonging to another (unauthorized) upload is rejected the same way', async () => {
  // Same shape as "altered signature": a public_id/version/signature triple
  // that was never issued by our /sign endpoint for this account, so its
  // signature does not verify against our secret either.
  const handler = createAdminMediaFinalizeHandler(finalizeDeps({ verifyUploadSignature: () => false }));
  const result = mockResponse();
  await handler(jsonRequest({ publicId: 'someone-elses-public-id', version: 1234567890, signature: 'b'.repeat(40) }), result.response);
  assert.equal(result.read().statusCode, 422);
});

test('finalize: a verified-but-out-of-policy result (bad dimensions) is rejected and destroy is attempted', async () => {
  let destroyedPublicId: string | null = null;
  const handler = createAdminMediaFinalizeHandler(
    finalizeDeps({
      fetchResourceMetadata: async () => ({ ...VALID_RESOURCE, width: 100, height: 100 }),
      destroyAsset: async (_env, publicId) => {
        destroyedPublicId = publicId;
        return { ok: true };
      },
    }),
  );
  const result = mockResponse();
  await handler(jsonRequest(VALID_FINALIZE_BODY), result.response);
  assert.equal(result.read().statusCode, 422);
  assert.equal(destroyedPublicId, VALID_FINALIZE_BODY.publicId);
});

test('finalize: an SVG-reported format is rejected and destroy is attempted', async () => {
  const handler = createAdminMediaFinalizeHandler(
    finalizeDeps({ fetchResourceMetadata: async () => ({ ...VALID_RESOURCE, format: 'svg' }) }),
  );
  const result = mockResponse();
  await handler(jsonRequest(VALID_FINALIZE_BODY), result.response);
  assert.equal(result.read().statusCode, 422);
});

test('finalize: a secure_url outside Cloudinary is rejected', async () => {
  const handler = createAdminMediaFinalizeHandler(
    finalizeDeps({ fetchResourceMetadata: async () => ({ ...VALID_RESOURCE, secure_url: 'https://attacker.invalid/x.jpg' }) }),
  );
  const result = mockResponse();
  await handler(jsonRequest(VALID_FINALIZE_BODY), result.response);
  assert.equal(result.read().statusCode, 422);
});

test('finalize: an expired authorization (ADM10 from the RPC) maps to 409 with a clear message', async () => {
  const handler = createAdminMediaFinalizeHandler(
    finalizeDeps({ userScopedClient: () => fakeRpcClient({ data: null, error: { code: 'ADM10' } }) }),
  );
  const result = mockResponse();
  await handler(jsonRequest(VALID_FINALIZE_BODY), result.response);
  const { statusCode, body } = result.read();
  assert.equal(statusCode, 409);
  assert.doesNotMatch(JSON.stringify(body), /ADM10|SQL|stack/);
});

test('finalize: a valid, in-policy, correctly signed result is registered and returns sanitized data', async () => {
  const handler = createAdminMediaFinalizeHandler(
    finalizeDeps({
      userScopedClient: () => fakeRpcClient({ data: { id: 'asset-1', secure_url: VALID_RESOURCE.secure_url, status: 'pending' }, error: null }),
    }),
  );
  const result = mockResponse();
  await handler(jsonRequest(VALID_FINALIZE_BODY), result.response);
  const { statusCode, body } = result.read();
  assert.equal(statusCode, 200);
  const payload = body as Record<string, unknown>;
  assert.equal(payload.mediaAssetId, 'asset-1');
  assert.equal(payload.url, VALID_RESOURCE.secure_url);
  assert.equal(payload.status, 'pending');
  assert.doesNotMatch(JSON.stringify(payload), new RegExp(TEST_ENV.apiSecret));
  assert.doesNotMatch(JSON.stringify(payload), /valid-token/);
});

test('finalize: never logs or returns the api secret even when Cloudinary is unreachable', async () => {
  const handler = createAdminMediaFinalizeHandler(finalizeDeps({ fetchResourceMetadata: async () => null }));
  const result = mockResponse();
  await handler(jsonRequest(VALID_FINALIZE_BODY), result.response);
  const { statusCode, body } = result.read();
  assert.equal(statusCode, 503);
  assert.doesNotMatch(JSON.stringify(body), new RegExp(TEST_ENV.apiSecret));
});
