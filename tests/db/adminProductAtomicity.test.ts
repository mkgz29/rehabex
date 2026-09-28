import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import { createClient } from '@supabase/supabase-js';

// Same local-only guard as tests/db/adminBoundaryConcurrency.test.ts: this
// suite exercises the real admin_create_product_with_media /
// admin_update_product_with_media RPCs (content + visibility atomicity,
// ADMIN-02B; gallery-specific atomicity is covered separately in
// tests/db/adminProductGallery.test.ts, ADMIN-02C) against a real Postgres
// transaction and must never be able to target a remote project.
const supabaseUrl = process.env.ATOMIC_TEST_SUPABASE_URL ?? process.env.SUPABASE_URL ?? process.env.API_URL ?? '';
const serviceRoleKey = process.env.ATOMIC_TEST_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SERVICE_ROLE_KEY ?? '';
const anonKey = process.env.ATOMIC_TEST_ANON_KEY ?? process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY ?? '';
const host = (() => {
  try {
    return new URL(supabaseUrl).hostname;
  } catch {
    return '';
  }
})();

if (!['127.0.0.1', 'localhost'].includes(host) || !serviceRoleKey || !anonKey) {
  throw new Error('Admin product atomicity test requires local Supabase credentials and refuses remote URLs.');
}

const serviceClient = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });

export async function createAdminUserClient(prefix = 'admin-atomicity') {
  const suffix = randomUUID();
  const email = `${prefix}-${suffix}@example.test`;
  const password = `Pw-${suffix}`;

  const { data: created, error: createError } = await serviceClient.auth.admin.createUser({ email, password, email_confirm: true });
  assert.equal(createError, null);
  const userId = created.user?.id;
  assert.ok(userId);

  const { error: roleError } = await serviceClient.from('profiles').update({ role: 'admin' }).eq('id', userId);
  assert.equal(roleError, null);

  const anonAuthClient = createClient(supabaseUrl, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: session, error: signInError } = await anonAuthClient.auth.signInWithPassword({ email, password });
  assert.equal(signInError, null);
  const accessToken = session.session?.access_token;
  assert.ok(accessToken);

  const userScopedClient = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });

  return { userId: userId as string, userScopedClient };
}

// admin_audit_events grants SELECT only to authenticated (gated by is_admin()
// RLS); service_role has no table grant at all, so reading it back must go
// through the admin's own client, exactly like
// tests/db/adminBoundaryConcurrency.test.ts already does.
export async function auditCount(client: ReturnType<typeof createClient>, entityId: string, action: string): Promise<number> {
  const { count, error } = await client
    .from('admin_audit_events')
    .select('id', { count: 'exact', head: true })
    .eq('entity_id', entityId)
    .eq('action', action);
  assert.equal(error, null);
  return count ?? 0;
}

async function productCountByName(name: string): Promise<number> {
  const { count, error } = await serviceClient.from('products').select('id', { count: 'exact', head: true }).eq('name', name);
  assert.equal(error, null);
  return count ?? 0;
}

function createProduct(client: ReturnType<typeof createClient>, overrides: Record<string, unknown> = {}) {
  return client.rpc('admin_create_product_with_media', {
    p_name: 'Producto de prueba',
    p_description: '',
    p_category: 'Ortopedia',
    p_price: 100,
    p_is_featured: false,
    p_display_order: 0,
    p_is_active: false,
    p_gallery: [],
    p_request_id: randomUUID(),
    ...overrides,
  });
}

function updateProduct(client: ReturnType<typeof createClient>, overrides: Record<string, unknown>) {
  return client.rpc('admin_update_product_with_media', {
    p_name: 'Producto de prueba',
    p_description: '',
    p_category: 'Ortopedia',
    p_price: 100,
    p_is_featured: false,
    p_display_order: 0,
    p_is_active: false,
    p_gallery: [],
    p_request_id: randomUUID(),
    ...overrides,
  });
}

test('creation atomicity: creating visible commits content and activation together, in one audit trail', async () => {
  const { userId, userScopedClient } = await createAdminUserClient();
  let productId: string | null = null;
  const name = `atomicity visible create ${randomUUID()}`;

  try {
    const { data, error } = await createProduct(userScopedClient, { p_name: name, p_is_active: true });
    assert.equal(error, null);
    productId = data.product.id;
    assert.equal(data.product.is_active, true, 'the single call must return the product already active');
    assert.deepEqual(data.gallery, []);

    const { data: fromDb, error: dbError } = await serviceClient.from('products').select('is_active, name').eq('id', productId).single();
    assert.equal(dbError, null);
    assert.equal(fromDb?.is_active, true, 'reloaded state must match what the RPC returned');
    assert.equal(fromDb?.name, name);

    assert.equal(await auditCount(userScopedClient, productId, 'product.created'), 1);
    assert.equal(await auditCount(userScopedClient, productId, 'product.activated'), 1);
  } finally {
    if (productId) await serviceClient.from('products').delete().eq('id', productId);
    await serviceClient.auth.admin.deleteUser(userId);
  }
});

test('creation atomicity: creating hidden commits content only, no activation audit event', async () => {
  const { userId, userScopedClient } = await createAdminUserClient();
  let productId: string | null = null;
  const name = `atomicity hidden create ${randomUUID()}`;

  try {
    const { data, error } = await createProduct(userScopedClient, { p_name: name, p_is_active: false });
    assert.equal(error, null);
    productId = data.product.id;
    assert.equal(data.product.is_active, false);
    assert.equal(await auditCount(userScopedClient, productId, 'product.created'), 1);
    assert.equal(await auditCount(userScopedClient, productId, 'product.activated'), 0);
  } finally {
    if (productId) await serviceClient.from('products').delete().eq('id', productId);
    await serviceClient.auth.admin.deleteUser(userId);
  }
});

test('a product with no image at all can be created and made visible in the same call', async () => {
  const { userId, userScopedClient } = await createAdminUserClient();
  let productId: string | null = null;

  try {
    const { data, error } = await createProduct(userScopedClient, { p_name: `atomicity no-image ${randomUUID()}`, p_is_active: true });
    assert.equal(error, null);
    productId = data.product.id;
    assert.equal(data.product.image_url, null);
    assert.equal(data.product.is_active, true);
  } finally {
    if (productId) await serviceClient.from('products').delete().eq('id', productId);
    await serviceClient.auth.admin.deleteUser(userId);
  }
});

test('edit atomicity: content and a visibility change in the same call commit together', async () => {
  const { userId, userScopedClient } = await createAdminUserClient();
  let productId: string | null = null;

  try {
    const { data: created, error: createError } = await createProduct(userScopedClient, { p_name: 'Before edit', p_is_active: false });
    assert.equal(createError, null);
    productId = created.product.id;

    const { data: edited, error: editError } = await updateProduct(userScopedClient, {
      p_product_id: productId,
      p_name: 'After edit',
      p_price: 120,
      p_is_active: true,
      p_expected_updated_at: created.product.updated_at,
    });
    assert.equal(editError, null);
    assert.equal(edited.product.name, 'After edit');
    assert.equal(Number(edited.product.price), 120);
    assert.equal(edited.product.is_active, true);

    const { data: fromDb } = await serviceClient.from('products').select('name, price, is_active').eq('id', productId).single();
    assert.deepEqual(fromDb, { name: 'After edit', price: 120, is_active: true });

    assert.equal(await auditCount(userScopedClient, productId, 'product.price_changed'), 1);
    assert.equal(await auditCount(userScopedClient, productId, 'product.activated'), 1);
  } finally {
    if (productId) await serviceClient.from('products').delete().eq('id', productId);
    await serviceClient.auth.admin.deleteUser(userId);
  }
});

test('internal failure rolls back everything: an edit that fails to activate leaves content unchanged too', async () => {
  const { userId, userScopedClient } = await createAdminUserClient();
  let productId: string | null = null;

  try {
    const { data: created, error: createError } = await createProduct(userScopedClient, { p_name: 'Original name', p_is_active: false });
    assert.equal(createError, null);
    productId = created.product.id;

    // Renaming into a reserved category *and* asking to activate in the same
    // call must fail the activation check and roll back the rename too --
    // proving this is one transaction, not "rename, then try to activate".
    const { data: failed, error: failError } = await updateProduct(userScopedClient, {
      p_product_id: productId,
      p_name: 'Renamed but should not stick',
      p_category: 'TEST',
      p_price: 999,
      p_is_active: true,
      p_expected_updated_at: created.product.updated_at,
    });
    assert.equal(failed, null);
    assert.equal(failError?.code, 'ADM22');

    const { data: fromDb } = await serviceClient.from('products').select('name, price, category, is_active, updated_at').eq('id', productId).single();
    assert.equal(fromDb?.name, 'Original name', 'the rename must have rolled back with the failed activation');
    assert.equal(Number(fromDb?.price), 100);
    assert.equal(fromDb?.category, 'Ortopedia');
    assert.equal(fromDb?.is_active, false);
    assert.equal(fromDb?.updated_at, created.product.updated_at, 'nothing was persisted, so the version must not have moved');

    assert.equal(await auditCount(userScopedClient, productId, 'product.updated'), 0);
    assert.equal(await auditCount(userScopedClient, productId, 'product.price_changed'), 0);
    assert.equal(await auditCount(userScopedClient, productId, 'product.activated'), 0);
  } finally {
    if (productId) await serviceClient.from('products').delete().eq('id', productId);
    await serviceClient.auth.admin.deleteUser(userId);
  }
});

test('concurrency conflict on the combined save modifies nothing: neither content nor visibility change', async () => {
  const { userId, userScopedClient } = await createAdminUserClient();
  let productId: string | null = null;

  try {
    const { data: created } = await createProduct(userScopedClient, { p_name: 'Race target', p_is_active: false });
    productId = created.product.id;
    const staleVersion = created.product.updated_at;

    const { data: winner, error: winnerError } = await updateProduct(userScopedClient, {
      p_product_id: productId,
      p_name: 'Winner',
      p_price: 150,
      p_is_active: true,
      p_expected_updated_at: staleVersion,
    });
    assert.equal(winnerError, null);
    assert.notEqual(winner.product.updated_at, staleVersion);

    // A second save, still holding the now-stale version, tries to change
    // both content and visibility at once: it must be rejected wholesale.
    const { data: loser, error: loserError } = await updateProduct(userScopedClient, {
      p_product_id: productId,
      p_name: 'Loser',
      p_price: 200,
      p_is_active: false,
      p_expected_updated_at: staleVersion,
    });
    assert.equal(loser, null);
    assert.equal(loserError?.code, 'ADM09');

    const { data: fromDb } = await serviceClient.from('products').select('name, price, is_active').eq('id', productId).single();
    assert.equal(fromDb?.name, 'Winner', 'the rejected request must not have changed content');
    assert.equal(Number(fromDb?.price), 150);
    assert.equal(fromDb?.is_active, true, 'the rejected request must not have changed visibility either');
  } finally {
    if (productId) await serviceClient.from('products').delete().eq('id', productId);
    await serviceClient.auth.admin.deleteUser(userId);
  }
});

test('retrying after a rejected save does not duplicate the product', async () => {
  const { userId, userScopedClient } = await createAdminUserClient();
  let productId: string | null = null;
  const name = `atomicity retry ${randomUUID()}`;

  try {
    const { data: created } = await createProduct(userScopedClient, { p_name: name, p_is_active: false });
    productId = created.product.id;

    const { error: failError } = await updateProduct(userScopedClient, {
      p_product_id: productId,
      p_name: name,
      p_category: 'PRUEBA',
      p_is_active: true,
      p_expected_updated_at: created.product.updated_at,
    });
    assert.equal(failError?.code, 'ADM22');

    // Retried correctly, using the still-current version (nothing was
    // persisted by the failed attempt, so the version has not moved).
    const { data: retried, error: retryError } = await updateProduct(userScopedClient, {
      p_product_id: productId,
      p_name: name,
      p_is_active: true,
      p_expected_updated_at: created.product.updated_at,
    });
    assert.equal(retryError, null);
    assert.equal(retried.product.is_active, true);

    assert.equal(await productCountByName(name), 1, 'retrying an edit must never create a second product');
  } finally {
    if (productId) await serviceClient.from('products').delete().eq('id', productId);
    await serviceClient.auth.admin.deleteUser(userId);
  }
});
