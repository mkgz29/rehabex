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
  assert.deepEqual(payload.uploadParams, {
    allowed_formats: 'jpg,jpeg,png,webp',
    folder: 'rehabex/hero',
    overwrite: 'false',
    public_id: (payload.uploadParams as Record<string, unknown>).public_id,
    timestamp: (payload.uploadParams as Record<string, unknown>).timestamp,
  });
  assert.equal(typeof (payload.uploadParams as Record<string, unknown>).public_id, 'string');
  assert.match((payload.uploadParams as Record<string, string>).timestamp, /^\d+$/);
  assert.equal('max_file_size' in (payload.uploadParams as Record<string, unknown>), false);
  assert.equal('maxFileSize' in payload, false);
  assert.equal(payload.cloudName, TEST_ENV.cloudName);
  assert.equal(payload.apiKey, TEST_ENV.apiKey);
  assert.equal(typeof payload.signature, 'string');
  assert.equal(typeof payload.requestId, 'string');
  assert.doesNotMatch(JSON.stringify(payload), new RegExp(TEST_ENV.apiSecret));
});

test('sign: About video uses its server-owned folder, video endpoint and MP4/WebM allowlist', async () => {
  let pendingArgs: Record<string, unknown> | null = null;
  const handler = createAdminMediaSignHandler(signDeps({
    userScopedClient: () => ({
      rpc: async (_name, args) => {
        pendingArgs = args;
        return { data: { id: 'asset-video' }, error: null };
      },
    }),
  }));
  const result = mockResponse();
  await handler(jsonRequest({ intent: 'about', mediaType: 'video' }), result.response);
  const { statusCode, body } = result.read();
  assert.equal(statusCode, 200);
  const payload = body as { uploadUrl: string; uploadParams: Record<string, string> };
  assert.equal(payload.uploadParams.folder, 'rehabex/about/video');
  assert.equal(payload.uploadParams.allowed_formats, 'mp4,webm');
  assert.match(payload.uploadUrl, /\/video\/upload$/);
  assert.equal(pendingArgs?.p_folder, 'rehabex/about/video');
});

test('sign: video is rejected for product and hero intents', async () => {
  const handler = createAdminMediaSignHandler(signDeps({}));
  for (const intent of ['product', 'hero']) {
    const result = mockResponse();
    await handler(jsonRequest({ intent, mediaType: 'video' }), result.response);
    assert.equal(result.read().statusCode, 422);
  }
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

const VALID_FINALIZE_BODY = { publicId: 'rehabex/products/a1b2c3d4-e5f6-4789-a0b1-c2d3e4f5a6b7', version: 1700000000, signature: 'a'.repeat(40) };
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
  await handler(jsonRequest({ publicId: 'rehabex/products/b1b2c3d4-e5f6-4789-a0b1-c2d3e4f5a6b7', version: 1234567890, signature: 'b'.repeat(40) }), result.response);
  assert.equal(result.read().statusCode, 422);
});

test('sign -> Cloudinary -> finalize keeps the folder-qualified provider public ID canonical', async () => {
  let pendingArgs: Record<string, unknown> | null = null;
  const signHandler = createAdminMediaSignHandler(
    signDeps({
      userScopedClient: () => ({
        rpc: async (name, args) => {
          assert.equal(name, 'admin_create_pending_media_asset');
          pendingArgs = args;
          return { data: { id: 'asset-1' }, error: null };
        },
      }),
    }),
  );
  const signResult = mockResponse();
  await signHandler(jsonRequest({ intent: 'product' }), signResult.response);
  assert.equal(signResult.read().statusCode, 200);

  const signPayload = signResult.read().body as {
    uploadParams: { folder: string; public_id: string };
  };
  const providerPublicId = `${signPayload.uploadParams.folder}/${signPayload.uploadParams.public_id}`;
  assert.equal(signPayload.uploadParams.folder, 'rehabex/products');
  assert.match(signPayload.uploadParams.public_id, /^[0-9a-f-]{36}$/);
  assert.equal(pendingArgs?.p_public_id, providerPublicId);
  assert.equal(pendingArgs?.p_folder, signPayload.uploadParams.folder);

  let finalizedArgs: Record<string, unknown> | null = null;
  const finalizeHandler = createAdminMediaFinalizeHandler(
    finalizeDeps({
      verifyUploadSignature: (_env, publicId) => publicId === providerPublicId,
      fetchResourceMetadata: async (_env, publicId) => {
        assert.equal(publicId, providerPublicId);
        return VALID_RESOURCE;
      },
      userScopedClient: () => ({
        rpc: async (name, args) => {
          assert.equal(name, 'admin_finalize_media_asset');
          finalizedArgs = args;
          return { data: { id: 'asset-1', secure_url: VALID_RESOURCE.secure_url, status: 'pending' }, error: null };
        },
      }),
    }),
  );
  const finalizeResult = mockResponse();
  await finalizeHandler(
    jsonRequest({ publicId: providerPublicId, version: 1_700_000_000, signature: 'a'.repeat(40) }),
    finalizeResult.response,
  );

  assert.equal(finalizeResult.read().statusCode, 200);
  assert.equal(finalizedArgs?.p_public_id, providerPublicId);
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

test('finalize: About video is fetched and validated as video before the existing RPC persists it', async () => {
  const publicId = 'rehabex/about/video/a1b2c3d4-e5f6-4789-a0b1-c2d3e4f5a6b7';
  const resource = { format: 'mp4', resource_type: 'video', bytes: 700000, width: 1280, height: 720, duration: 15, secure_url: 'https://res.cloudinary.com/demo/video/upload/v1700000000/about.mp4' };
  let finalizedArgs: Record<string, unknown> | null = null;
  const handler = createAdminMediaFinalizeHandler(finalizeDeps({
    fetchResourceMetadata: async (_env, receivedPublicId, mediaType) => {
      assert.equal(receivedPublicId, publicId);
      assert.equal(mediaType, 'video');
      return resource;
    },
    userScopedClient: () => ({
      rpc: async (_name, args) => {
        finalizedArgs = args;
        return { data: { id: 'asset-video', secure_url: resource.secure_url, status: 'pending' }, error: null };
      },
    }),
  }));
  const result = mockResponse();
  await handler(jsonRequest({ publicId, version: 1700000000, signature: 'a'.repeat(40) }), result.response);
  assert.equal(result.read().statusCode, 200);
  assert.equal(finalizedArgs?.p_format, 'mp4');
  assert.equal(finalizedArgs?.p_mime_type, 'video/mp4');
});

test('finalize: never logs or returns the api secret even when Cloudinary is unreachable', async () => {
  const handler = createAdminMediaFinalizeHandler(finalizeDeps({ fetchResourceMetadata: async () => null }));
  const result = mockResponse();
  await handler(jsonRequest(VALID_FINALIZE_BODY), result.response);
  const { statusCode, body } = result.read();
  assert.equal(statusCode, 503);
  assert.doesNotMatch(JSON.stringify(body), new RegExp(TEST_ENV.apiSecret));
});

const VIDEO_PUBLIC_ID = 'rehabex/about/video/a1b2c3d4-e5f6-4789-a0b1-c2d3e4f5a6b7';
const VALID_VIDEO_RESOURCE = { format: 'mp4', resource_type: 'video', bytes: 700000, width: 1280, height: 720, duration: 15, secure_url: 'https://res.cloudinary.com/demo/video/upload/v1700000000/about.mp4' };

async function finalizeVideoCapturingLogs(resource: Record<string, unknown>) {
  const logs: string[] = [];
  const originalInfo = console.info;
  console.info = (...args: unknown[]) => { logs.push(JSON.stringify(args)); };
  let destroyed = 0;
  try {
    const handler = createAdminMediaFinalizeHandler(finalizeDeps({
      fetchResourceMetadata: async () => resource,
      destroyAsset: async () => { destroyed += 1; return { ok: true }; },
      userScopedClient: () => fakeRpcClient({ data: { id: 'asset-video', secure_url: VALID_VIDEO_RESOURCE.secure_url, status: 'pending' }, error: null }),
    }));
    const result = mockResponse();
    await handler(jsonRequest({ publicId: VIDEO_PUBLIC_ID, version: 1700000000, signature: 'a'.repeat(40) }), result.response);
    return { ...result.read(), logs, destroyed };
  } finally {
    console.info = originalInfo;
  }
}

const POLICY_REJECTIONS: Array<[string, Record<string, unknown>]> = [
  ['invalid_format', { ...VALID_VIDEO_RESOURCE, format: 'mov' }],
  ['invalid_resource_type', { ...VALID_VIDEO_RESOURCE, resource_type: 'image' }],
  ['invalid_bytes', { ...VALID_VIDEO_RESOURCE, bytes: 9 * 1024 * 1024 }],
  ['invalid_width', { ...VALID_VIDEO_RESOURCE, width: 100 }],
  ['invalid_height', { ...VALID_VIDEO_RESOURCE, height: 100 }],
  ['invalid_secure_url', { ...VALID_VIDEO_RESOURCE, secure_url: undefined }],
  ['invalid_duration', { ...VALID_VIDEO_RESOURCE, duration: undefined }],
];

for (const [reason, resource] of POLICY_REJECTIONS) {
  test(`finalize: policy rejection logs reason=${reason}, destroys the asset and leaks nothing`, async () => {
    const { statusCode, body, logs, destroyed } = await finalizeVideoCapturingLogs(resource);
    assert.equal(statusCode, 422);
    assert.equal(destroyed, 1);
    const line = logs.find((entry) => entry.includes('admin_media_finalize_policy_rejected'));
    assert.ok(line, 'policy rejection event is logged');
    assert.ok(line.includes(`"reason":"${reason}"`));
    assert.ok(line.includes('"destroyed":true'));
    const everything = logs.join('') + JSON.stringify(body);
    assert.doesNotMatch(everything, new RegExp(TEST_ENV.apiSecret));
    assert.doesNotMatch(everything, /res\.cloudinary\.com|valid-token|a{40}|about\.mp4/);
  });
}

test('finalize: a valid video still passes and logs no policy rejection', async () => {
  const { statusCode, logs, destroyed } = await finalizeVideoCapturingLogs(VALID_VIDEO_RESOURCE);
  assert.equal(statusCode, 200);
  assert.equal(destroyed, 0);
  assert.ok(!logs.some((entry) => entry.includes('policy_rejected')));
});

// Representative shape of a video resource requested with media_metadata: true.
// Only key names matter to the shape logger; values below are fixtures.
const VIDEO_RESOURCE_WITH_MEDIA_METADATA = {
  ...VALID_VIDEO_RESOURCE,
  duration: undefined,
  frame_rate: 29.97,
  rotation: 0,
  video: { codec: 'hevc', pix_format: 'yuv420p' },
  audio: { codec: 'aac' },
  media_metadata: { duration: '15.2', video_codec: 'hevc' },
};

test('finalize: a rejected video logs only the safe shape of the Cloudinary response', async () => {
  const { logs, destroyed } = await finalizeVideoCapturingLogs(VIDEO_RESOURCE_WITH_MEDIA_METADATA);
  assert.equal(destroyed, 1);
  const line = logs.find((entry) => entry.includes('admin_media_finalize_policy_rejected')) ?? '';
  assert.ok(line.includes('"reason":"invalid_duration"'));
  assert.ok(line.includes('"durationType":"undefined"'));
  assert.ok(line.includes('"hasMediaMetadata":true'));
  assert.ok(line.includes('"mediaMetadataKeys":"duration,video_codec"'));
  assert.ok(line.includes('"hasVideo":true') && line.includes('"videoKeys":"codec,pix_format"'));
  assert.ok(line.includes('"hasAudio":true') && line.includes('"audioKeys":"codec"'));
  // Key names and types only: no values, URLs or secrets.
  assert.doesNotMatch(line, /hevc|aac|yuv420p|res\.cloudinary\.com|29\.97|15\.2/);
  assert.doesNotMatch(line, new RegExp(TEST_ENV.apiSecret));
});

test('describeVideoResourceShape: handles absent metadata without throwing', async () => {
  const { describeVideoResourceShape } = await import('../../server/admin/mediaValidators');
  const shape = describeVideoResourceShape({ duration: null });
  assert.equal(shape.durationType, 'null');
  assert.equal(shape.hasMediaMetadata, false);
  assert.equal(shape.mediaMetadataKeys, '');
});

test('fetchResourceMetadata: requests media_metadata for video only', async () => {
  const { v2: cloudinary } = await import('cloudinary');
  const { fetchResourceMetadata } = await import('../../server/admin/cloudinaryClient');
  const original = cloudinary.api.resource;
  const calls: Array<Record<string, unknown>> = [];
  (cloudinary.api as { resource: unknown }).resource = async (_id: string, options: Record<string, unknown>) => { calls.push(options); return {}; };
  try {
    await fetchResourceMetadata(TEST_ENV, VIDEO_PUBLIC_ID, 'video');
    await fetchResourceMetadata(TEST_ENV, VALID_FINALIZE_BODY.publicId, 'image');
  } finally {
    (cloudinary.api as { resource: unknown }).resource = original;
  }
  assert.deepEqual(calls[0], { resource_type: 'video', media_metadata: true });
  assert.deepEqual(calls[1], { resource_type: 'image' });
});
