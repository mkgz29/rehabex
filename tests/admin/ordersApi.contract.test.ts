import assert from 'node:assert/strict';
import test from 'node:test';

import handler from '../../api/orders';
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
const ORDER_ID = '22222222-2222-4222-8222-222222222222';

function request(query: Record<string, string | string[] | undefined> = {}, headers: Record<string, string> = {}): ApiRequest & { query: typeof query } {
  return {
    method: 'GET',
    headers: { authorization: 'Bearer valid-token', ...headers },
    query,
  };
}

function orderRow(overrides: Record<string, unknown> = {}) {
  return {
    id: ORDER_ID,
    order_number: 'RHB-202610-000001',
    payment_status: 'approved',
    order_status: 'confirmed',
    fulfillment_status: 'not_started',
    ...overrides,
  };
}

function fakeServiceClient(options: {
  noUser?: boolean;
  role?: string | null;
  listResult?: { data: unknown[] | null; error: unknown };
  singleResult?: { data: unknown | null; error: unknown };
  onOrdersSelect?: (columns: string) => void;
}) {
  return () => ({
    auth: {
      async getUser() {
        if (options.noUser) return { data: { user: null }, error: { message: 'invalid token' } };
        return { data: { user: { id: ADMIN_ID } }, error: null };
      },
    },
    from(table: string) {
      if (table === 'profiles') {
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
      }
      // orders: .select(...).order(...).limit(...) for the list path,
      // .select(...).eq('id', ...).maybeSingle() for the single-order path.
      return {
        select(columns: string) {
          options.onOrdersSelect?.(columns);
          return this;
        },
        eq() {
          return this;
        },
        order() {
          return this;
        },
        limit: () => Promise.resolve(options.listResult ?? { data: [], error: null }),
        maybeSingle: () => Promise.resolve(options.singleResult ?? { data: null, error: null }),
      };
    },
  });
}

test('GET /api/orders: a non-GET method is rejected with 405', async () => {
  const result = mockResponse();
  await handler({ method: 'POST', headers: {} }, result.response, { serviceClient: fakeServiceClient({}) });
  assert.equal(result.read().statusCode, 405);
});

test('GET /api/orders: a missing Authorization header is rejected with 401', async () => {
  const req = request();
  delete req.headers!.authorization;
  const result = mockResponse();
  await handler(req, result.response, { serviceClient: fakeServiceClient({}) });
  assert.equal(result.read().statusCode, 401);
});

test('GET /api/orders: an authenticated non-admin is rejected with 403, with or without an id', async () => {
  const deps = { serviceClient: fakeServiceClient({ role: 'customer' }) };
  const result1 = mockResponse();
  await handler(request(), result1.response, deps);
  assert.equal(result1.read().statusCode, 403);

  const result2 = mockResponse();
  await handler(request({ id: ORDER_ID }), result2.response, deps);
  assert.equal(result2.read().statusCode, 403);
});

test('GET /api/orders: without an id, behaves exactly as before (the capped, most-recent list)', async () => {
  const rows = [orderRow(), orderRow({ id: '33333333-3333-4333-8333-333333333333' })];
  const result = mockResponse();
  await handler(request(), result.response, { serviceClient: fakeServiceClient({ listResult: { data: rows, error: null } }) });
  const { statusCode, body } = result.read();
  assert.equal(statusCode, 200);
  assert.deepEqual((body as { orders: unknown[] }).orders, rows);
});

test('GET /api/orders: an existing id returns that single order wrapped the same way', async () => {
  const row = orderRow();
  const result = mockResponse();
  await handler(request({ id: ORDER_ID }), result.response, { serviceClient: fakeServiceClient({ singleResult: { data: row, error: null } }) });
  const { statusCode, body } = result.read();
  assert.equal(statusCode, 200);
  assert.deepEqual((body as { orders: unknown[] }).orders, [row]);
});

test('GET /api/orders: an unknown (but well-formed) id returns 404', async () => {
  const result = mockResponse();
  await handler(request({ id: ORDER_ID }), result.response, { serviceClient: fakeServiceClient({ singleResult: { data: null, error: null } }) });
  assert.equal(result.read().statusCode, 404);
});

test('GET /api/orders: a malformed id is rejected with 400 and never reaches the database', async () => {
  let queried = false;
  const deps = {
    serviceClient: () => {
      const client = fakeServiceClient({ singleResult: { data: null, error: null } })();
      const originalFrom = client.from.bind(client);
      client.from = (table: string) => {
        if (table === 'orders') queried = true;
        return originalFrom(table);
      };
      return client;
    },
  };
  for (const badId of ['not-a-uuid', '12345', '', "1' OR '1'='1"]) {
    const result = mockResponse();
    await handler(request({ id: badId }), result.response, deps);
    assert.equal(result.read().statusCode, 400, `expected 400 for id=${JSON.stringify(badId)}`);
  }
  assert.equal(queried, false);
});

test('GET /api/orders: the admin projection includes customer_phone (needed for the Soporte/Pedidos WhatsApp action)', async () => {
  let selectedColumns = '';
  const result = mockResponse();
  await handler(request(), result.response, {
    serviceClient: fakeServiceClient({ listResult: { data: [], error: null }, onOrdersSelect: (columns) => { selectedColumns = columns; } }),
  });
  assert.equal(result.read().statusCode, 200);
  assert.match(selectedColumns, /\bcustomer_phone\b/);
});

test('GET /api/orders: only the first value of a repeated id query param is used', async () => {
  const row = orderRow();
  const result = mockResponse();
  await handler(request({ id: [ORDER_ID, '44444444-4444-4444-8444-444444444444'] }), result.response, {
    serviceClient: fakeServiceClient({ singleResult: { data: row, error: null } }),
  });
  assert.equal(result.read().statusCode, 200);
});
