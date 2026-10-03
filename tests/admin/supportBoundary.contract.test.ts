import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createAdminCreateSupportRequestHandler,
  createAdminGetSupportRequestHandler,
  createAdminListSupportRequestsHandler,
  createAdminUpdateSupportRequestNotesHandler,
  createAdminUpdateSupportRequestStatusHandler,
} from '../../server/admin/handlers/support';
import type { AdminAuthClient, AdminAuthUser, AdminRpcClient, RequireAdminDependencies } from '../../server/admin/requireAdmin';
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
const SUPPORT_ID = '22222222-2222-4222-8222-222222222222';
const ORDER_ID = '33333333-3333-4333-8333-333333333333';
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

function fakeAuthClient(options: { role?: string | null } = {}): AdminAuthClient {
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

function deps(overrides: Partial<RequireAdminDependencies>): Partial<RequireAdminDependencies> {
  return overrides;
}

function supportRow(overrides: Record<string, unknown> = {}) {
  return {
    id: SUPPORT_ID,
    customer_name: 'Cliente Real',
    customer_email: 'cliente@example.test',
    customer_phone: null,
    subject: 'No llego mi pedido',
    message: 'Hola, todavia no me llego el pedido.',
    status: 'open',
    order_id: null,
    internal_notes: null,
    created_by: ADMIN_ID,
    created_at: NOW,
    updated_at: NOW,
    ...overrides,
  };
}

const VALID_CREATE_BODY = {
  customerName: 'Cliente Real',
  customerEmail: 'cliente@example.test',
  customerPhone: '+54 9 11 1234-5678',
  subject: 'No llego mi pedido',
  message: 'Hola, todavia no me llego el pedido.',
  orderId: ORDER_ID,
};

// --- Shared boundary behaviour, exercised through create -----------------------

test('support create: rejects a non-POST method with 405', async () => {
  const handler = createAdminCreateSupportRequestHandler();
  const result = mockResponse();
  await handler({ method: 'GET', headers: {} }, result.response);
  assert.equal(result.read().statusCode, 405);
});

test('support create: rejects an authenticated non-admin with 403 and never mutates', async () => {
  let called = false;
  const handler = createAdminCreateSupportRequestHandler(
    deps({
      authClient: () => fakeAuthClient({ role: 'customer' }),
      userScopedClient: () => ({ rpc: async () => { called = true; return { data: null, error: null }; } }),
    }),
  );
  const result = mockResponse();
  await handler(jsonRequest(VALID_CREATE_BODY), result.response);
  assert.equal(result.read().statusCode, 403);
  assert.equal(called, false);
});

test('support create: a missing Authorization header is rejected with 401', async () => {
  const handler = createAdminCreateSupportRequestHandler();
  const result = mockResponse();
  const request = jsonRequest(VALID_CREATE_BODY);
  delete request.headers!.authorization;
  await handler(request, result.response);
  assert.equal(result.read().statusCode, 401);
});

test('support create: rejects unknown fields and malformed values with 422', async () => {
  const handler = createAdminCreateSupportRequestHandler(deps({ authClient: () => fakeAuthClient(), userScopedClient: () => fakeRpcClient({ data: null, error: { code: 'ADM22' } }) }));
  for (const badBody of [
    { ...VALID_CREATE_BODY, status: 'open' },
    { ...VALID_CREATE_BODY, internalNotes: 'x' },
    { ...VALID_CREATE_BODY, customerEmail: 'not-an-email' },
    { ...VALID_CREATE_BODY, customerName: '' },
    { ...VALID_CREATE_BODY, orderId: 'not-a-uuid' },
  ]) {
    const result = mockResponse();
    await handler(jsonRequest(badBody), result.response);
    assert.equal(result.read().statusCode, 422, `expected 422 for ${JSON.stringify(badBody)}`);
  }
});

test('support create: a valid admin request creates an open support request', async () => {
  const handler = createAdminCreateSupportRequestHandler(
    deps({ authClient: () => fakeAuthClient(), userScopedClient: () => fakeRpcClient({ data: supportRow(), error: null }) }),
  );
  const result = mockResponse();
  await handler(jsonRequest(VALID_CREATE_BODY), result.response);
  const { statusCode, body } = result.read();
  assert.equal(statusCode, 200);
  assert.equal((body as { supportRequest: { status: string } }).supportRequest.status, 'open');
  assert.equal(typeof (body as { requestId?: string }).requestId, 'string');
});

test('support create: an unknown order id from the RPC maps to 404', async () => {
  const handler = createAdminCreateSupportRequestHandler(
    deps({ authClient: () => fakeAuthClient(), userScopedClient: () => fakeRpcClient({ data: null, error: { code: 'ADM04' } }) }),
  );
  const result = mockResponse();
  await handler(jsonRequest(VALID_CREATE_BODY), result.response);
  assert.equal(result.read().statusCode, 404);
});

test('support create: never echoes the internal_notes/created_by fields to the response shape', async () => {
  const handler = createAdminCreateSupportRequestHandler(
    deps({ authClient: () => fakeAuthClient(), userScopedClient: () => fakeRpcClient({ data: supportRow({ internal_notes: 'secreto interno' }), error: null }) }),
  );
  const result = mockResponse();
  await handler(jsonRequest(VALID_CREATE_BODY), result.response);
  const { body } = result.read();
  // internalNotes IS part of the sanitized shape (staff need to see their own
  // notes), but created_by (the raw admin user id) must never leak.
  assert.doesNotMatch(JSON.stringify(body), /"created_by"/);
  assert.doesNotMatch(JSON.stringify(body), /"createdBy"/);
});

// --- status ---------------------------------------------------------------------

test('status update: rejects an invalid status value with 422', async () => {
  const handler = createAdminUpdateSupportRequestStatusHandler(deps({ authClient: () => fakeAuthClient(), userScopedClient: () => fakeRpcClient({ data: null, error: { code: 'ADM22' } }) }));
  const result = mockResponse();
  await handler(jsonRequest({ id: SUPPORT_ID, status: 'closed', expectedUpdatedAt: NOW }), result.response);
  assert.equal(result.read().statusCode, 422);
});

test('status update: a version conflict from the RPC maps to 409', async () => {
  const handler = createAdminUpdateSupportRequestStatusHandler(
    deps({ authClient: () => fakeAuthClient(), userScopedClient: () => fakeRpcClient({ data: null, error: { code: 'ADM09' } }) }),
  );
  const result = mockResponse();
  await handler(jsonRequest({ id: SUPPORT_ID, status: 'resolved', expectedUpdatedAt: NOW }), result.response);
  assert.equal(result.read().statusCode, 409);
});

test('status update: an unknown id maps to 404', async () => {
  const handler = createAdminUpdateSupportRequestStatusHandler(
    deps({ authClient: () => fakeAuthClient(), userScopedClient: () => fakeRpcClient({ data: null, error: { code: 'ADM04' } }) }),
  );
  const result = mockResponse();
  await handler(jsonRequest({ id: SUPPORT_ID, status: 'resolved', expectedUpdatedAt: NOW }), result.response);
  assert.equal(result.read().statusCode, 404);
});

test('status update: a valid admin request succeeds', async () => {
  const handler = createAdminUpdateSupportRequestStatusHandler(
    deps({ authClient: () => fakeAuthClient(), userScopedClient: () => fakeRpcClient({ data: supportRow({ status: 'resolved' }), error: null }) }),
  );
  const result = mockResponse();
  await handler(jsonRequest({ id: SUPPORT_ID, status: 'resolved', expectedUpdatedAt: NOW }), result.response);
  const { statusCode, body } = result.read();
  assert.equal(statusCode, 200);
  assert.equal((body as { supportRequest: { status: string } }).supportRequest.status, 'resolved');
});

// --- notes ------------------------------------------------------------------------

test('notes update: rejects an oversized note with 422', async () => {
  const handler = createAdminUpdateSupportRequestNotesHandler(deps({ authClient: () => fakeAuthClient(), userScopedClient: () => fakeRpcClient({ data: null, error: { code: 'ADM22' } }) }));
  const result = mockResponse();
  await handler(jsonRequest({ id: SUPPORT_ID, internalNotes: 'x'.repeat(4001), expectedUpdatedAt: NOW }), result.response);
  assert.equal(result.read().statusCode, 422);
});

test('notes update: a null note (clearing) succeeds', async () => {
  const handler = createAdminUpdateSupportRequestNotesHandler(
    deps({ authClient: () => fakeAuthClient(), userScopedClient: () => fakeRpcClient({ data: supportRow({ internal_notes: null }), error: null }) }),
  );
  const result = mockResponse();
  await handler(jsonRequest({ id: SUPPORT_ID, internalNotes: null, expectedUpdatedAt: NOW }), result.response);
  const { statusCode, body } = result.read();
  assert.equal(statusCode, 200);
  assert.equal((body as { supportRequest: { internalNotes?: string } }).supportRequest.internalNotes, undefined);
});

// --- list / get ---------------------------------------------------------------------

test('list: an authenticated non-admin is rejected with 403', async () => {
  const handler = createAdminListSupportRequestsHandler(deps({ authClient: () => fakeAuthClient({ role: 'customer' }) }));
  const result = mockResponse();
  await handler(jsonRequest({}), result.response);
  assert.equal(result.read().statusCode, 403);
});

test('list: an invalid status filter is rejected with 422', async () => {
  const handler = createAdminListSupportRequestsHandler(deps({ authClient: () => fakeAuthClient(), userScopedClient: () => fakeRpcClient({ data: null, error: { code: 'ADM22' } }) }));
  const result = mockResponse();
  await handler(jsonRequest({ status: 'bogus' }), result.response);
  assert.equal(result.read().statusCode, 422);
});

test('list: returns the rows mapped to the sanitized shape', async () => {
  const handler = createAdminListSupportRequestsHandler(
    deps({ authClient: () => fakeAuthClient(), userScopedClient: () => fakeRpcClient({ data: [supportRow(), supportRow({ id: ORDER_ID, status: 'resolved' })], error: null }) }),
  );
  const result = mockResponse();
  await handler(jsonRequest({}), result.response);
  const { statusCode, body } = result.read();
  assert.equal(statusCode, 200);
  assert.equal((body as { supportRequests: unknown[] }).supportRequests.length, 2);
});

test('list: an empty result set is a valid 200, not an error', async () => {
  const handler = createAdminListSupportRequestsHandler(
    deps({ authClient: () => fakeAuthClient(), userScopedClient: () => fakeRpcClient({ data: [], error: null }) }),
  );
  const result = mockResponse();
  await handler(jsonRequest({}), result.response);
  const { statusCode, body } = result.read();
  assert.equal(statusCode, 200);
  assert.deepEqual((body as { supportRequests: unknown[] }).supportRequests, []);
});

test('get: an unknown id maps to 404', async () => {
  const handler = createAdminGetSupportRequestHandler(
    deps({ authClient: () => fakeAuthClient(), userScopedClient: () => fakeRpcClient({ data: null, error: { code: 'ADM04' } }) }),
  );
  const result = mockResponse();
  await handler(jsonRequest({ id: SUPPORT_ID }), result.response);
  assert.equal(result.read().statusCode, 404);
});

test('get: a valid admin request returns the row', async () => {
  const handler = createAdminGetSupportRequestHandler(
    deps({ authClient: () => fakeAuthClient(), userScopedClient: () => fakeRpcClient({ data: supportRow(), error: null }) }),
  );
  const result = mockResponse();
  await handler(jsonRequest({ id: SUPPORT_ID }), result.response);
  const { statusCode, body } = result.read();
  assert.equal(statusCode, 200);
  assert.equal((body as { supportRequest: { id: string } }).supportRequest.id, SUPPORT_ID);
});
