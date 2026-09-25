import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import { createClient } from '@supabase/supabase-js';

// Same local-only guard as tests/db/adminBoundaryConcurrency.test.ts: this
// suite exercises the real ADMIN-02B RPCs (admin_create_product_with_media /
// admin_update_product_with_media with p_is_active) against a real Postgres
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

async function createAdminUserClient() {
  const suffix = randomUUID();
  const email = `admin-02b-atomicity-${suffix}@example.test`;
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
// RLS); service_role has no table grant at all (see admin_01b_admin_boundary
// .sql), so reading it back must go through the admin's own client, exactly
// like tests/db/adminBoundaryConcurrency.test.ts already does.
async function auditCount(client: ReturnType<typeof createClient>, entityId: string, action: string): Promise<number> {
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

test('creation atomicity: creating visible commits content and activation together, in one audit trail', async () => {
  const { userId, userScopedClient } = await createAdminUserClient();
  let productId: string | null = null;
  const name = `ADMIN-02B visible create ${randomUUID()}`;

  try {
    const { data, error } = await userScopedClient.rpc('admin_create_product_with_media', {
      p_name: name,
      p_description: '',
      p_category: 'Ortopedia',
      p_price: 100,
      p_image_url: null,
      p_image_asset_id: null,
      p_is_featured: false,
      p_display_order: 0,
      p_is_active: true,
      p_request_id: randomUUID(),
    });
    assert.equal(error, null);
    productId = data.id;
    assert.equal(data.is_active, true, 'the single call must return the product already active');

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
  const name = `ADMIN-02B hidden create ${randomUUID()}`;

  try {
    const { data, error } = await userScopedClient.rpc('admin_create_product_with_media', {
      p_name: name,
      p_description: '',
      p_category: 'Ortopedia',
      p_price: 100,
      p_image_url: null,
      p_image_asset_id: null,
      p_is_featured: false,
      p_display_order: 0,
      p_is_active: false,
      p_request_id: randomUUID(),
    });
    assert.equal(error, null);
    productId = data.id;
    assert.equal(data.is_active, false);
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
    const { data, error } = await userScopedClient.rpc('admin_create_product_with_media', {
      p_name: `ADMIN-02B no-image ${randomUUID()}`,
      p_description: '',
      p_category: 'Ortopedia',
      p_price: 50,
      p_image_url: null,
      p_image_asset_id: null,
      p_is_featured: false,
      p_display_order: 0,
      p_is_active: true,
      p_request_id: randomUUID(),
    });
    assert.equal(error, null);
    productId = data.id;
    assert.equal(data.image_url, null);
    assert.equal(data.is_active, true);
  } finally {
    if (productId) await serviceClient.from('products').delete().eq('id', productId);
    await serviceClient.auth.admin.deleteUser(userId);
  }
});

test('edit atomicity: content and a visibility change in the same call commit together, image untouched', async () => {
  const { userId, userScopedClient } = await createAdminUserClient();
  let productId: string | null = null;

  try {
    const { data: created, error: createError } = await userScopedClient.rpc('admin_create_product_with_media', {
      p_name: 'Before edit',
      p_description: '',
      p_category: 'Ortopedia',
      p_price: 100,
      p_image_url: 'https://images.example.test/original.jpg',
      p_image_asset_id: null,
      p_is_featured: false,
      p_display_order: 0,
      p_is_active: false,
      p_request_id: randomUUID(),
    });
    assert.equal(createError, null);
    productId = created.id;

    const { data: edited, error: editError } = await userScopedClient.rpc('admin_update_product_with_media', {
      p_product_id: productId,
      p_name: 'After edit',
      p_description: '',
      p_category: 'Ortopedia',
      p_price: 120,
      // No new upload this edit: the real client always resends the
      // *current* image_url from form state (imageFieldsForRequest in
      // adminApi.ts) rather than null -- null actually clears the image, by
      // this same RPC's existing, unmodified contract.
      p_image_url: 'https://images.example.test/original.jpg',
      p_image_asset_id: null,
      p_is_featured: false,
      p_display_order: 0,
      p_is_active: true,
      p_expected_updated_at: created.updated_at,
      p_request_id: randomUUID(),
    });
    assert.equal(editError, null);
    assert.equal(edited.name, 'After edit');
    assert.equal(Number(edited.price), 120);
    assert.equal(edited.is_active, true);
    assert.equal(edited.image_url, 'https://images.example.test/original.jpg', 'the main image must survive an edit that does not touch it');

    const { data: fromDb } = await serviceClient.from('products').select('name, price, is_active, image_url').eq('id', productId).single();
    assert.deepEqual(fromDb, { name: 'After edit', price: 120, is_active: true, image_url: 'https://images.example.test/original.jpg' });

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
    const { data: created, error: createError } = await userScopedClient.rpc('admin_create_product_with_media', {
      p_name: 'Original name',
      p_description: '',
      p_category: 'Ortopedia',
      p_price: 100,
      p_image_url: null,
      p_image_asset_id: null,
      p_is_featured: false,
      p_display_order: 0,
      p_is_active: false,
      p_request_id: randomUUID(),
    });
    assert.equal(createError, null);
    productId = created.id;

    // Renaming into a reserved category *and* asking to activate in the same
    // call must fail the activation check and roll back the rename too --
    // proving this is one transaction, not "rename, then try to activate".
    const { data: failed, error: failError } = await userScopedClient.rpc('admin_update_product_with_media', {
      p_product_id: productId,
      p_name: 'Renamed but should not stick',
      p_description: '',
      p_category: 'TEST',
      p_price: 999,
      p_image_url: null,
      p_image_asset_id: null,
      p_is_featured: false,
      p_display_order: 0,
      p_is_active: true,
      p_expected_updated_at: created.updated_at,
      p_request_id: randomUUID(),
    });
    assert.equal(failed, null);
    assert.equal(failError?.code, 'ADM22');

    const { data: fromDb } = await serviceClient.from('products').select('name, price, category, is_active, updated_at').eq('id', productId).single();
    assert.equal(fromDb?.name, 'Original name', 'the rename must have rolled back with the failed activation');
    assert.equal(Number(fromDb?.price), 100);
    assert.equal(fromDb?.category, 'Ortopedia');
    assert.equal(fromDb?.is_active, false);
    assert.equal(fromDb?.updated_at, created.updated_at, 'nothing was persisted, so the version must not have moved');

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
    const { data: created } = await userScopedClient.rpc('admin_create_product_with_media', {
      p_name: 'Race target',
      p_description: '',
      p_category: 'Ortopedia',
      p_price: 100,
      p_image_url: null,
      p_image_asset_id: null,
      p_is_featured: false,
      p_display_order: 0,
      p_is_active: false,
      p_request_id: randomUUID(),
    });
    productId = created.id;
    const staleVersion = created.updated_at;

    // A first save succeeds and moves the version forward.
    const { data: winner, error: winnerError } = await userScopedClient.rpc('admin_update_product_with_media', {
      p_product_id: productId,
      p_name: 'Winner',
      p_description: '',
      p_category: 'Ortopedia',
      p_price: 150,
      p_image_url: null,
      p_image_asset_id: null,
      p_is_featured: false,
      p_display_order: 0,
      p_is_active: true,
      p_expected_updated_at: staleVersion,
      p_request_id: randomUUID(),
    });
    assert.equal(winnerError, null);
    assert.notEqual(winner.updated_at, staleVersion);

    // A second save, still holding the now-stale version, tries to change
    // both content and visibility at once: it must be rejected wholesale.
    const { data: loser, error: loserError } = await userScopedClient.rpc('admin_update_product_with_media', {
      p_product_id: productId,
      p_name: 'Loser',
      p_description: '',
      p_category: 'Ortopedia',
      p_price: 200,
      p_image_url: null,
      p_image_asset_id: null,
      p_is_featured: false,
      p_display_order: 0,
      p_is_active: false,
      p_expected_updated_at: staleVersion,
      p_request_id: randomUUID(),
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
  const name = `ADMIN-02B retry ${randomUUID()}`;

  try {
    const { data: created } = await userScopedClient.rpc('admin_create_product_with_media', {
      p_name: name,
      p_description: '',
      p_category: 'Ortopedia',
      p_price: 100,
      p_image_url: null,
      p_image_asset_id: null,
      p_is_featured: false,
      p_display_order: 0,
      p_is_active: false,
      p_request_id: randomUUID(),
    });
    productId = created.id;

    // A failed activation attempt (reserved category)...
    const { error: failError } = await userScopedClient.rpc('admin_update_product_with_media', {
      p_product_id: productId,
      p_name: name,
      p_description: '',
      p_category: 'PRUEBA',
      p_price: 100,
      p_image_url: null,
      p_image_asset_id: null,
      p_is_featured: false,
      p_display_order: 0,
      p_is_active: true,
      p_expected_updated_at: created.updated_at,
      p_request_id: randomUUID(),
    });
    assert.equal(failError?.code, 'ADM22');

    // ...retried correctly, using the still-current version (nothing was
    // persisted by the failed attempt, so the version has not moved).
    const { data: retried, error: retryError } = await userScopedClient.rpc('admin_update_product_with_media', {
      p_product_id: productId,
      p_name: name,
      p_description: '',
      p_category: 'Ortopedia',
      p_price: 100,
      p_image_url: null,
      p_image_asset_id: null,
      p_is_featured: false,
      p_display_order: 0,
      p_is_active: true,
      p_expected_updated_at: created.updated_at,
      p_request_id: randomUUID(),
    });
    assert.equal(retryError, null);
    assert.equal(retried.is_active, true);

    assert.equal(await productCountByName(name), 1, 'retrying an edit must never create a second product');
  } finally {
    if (productId) await serviceClient.from('products').delete().eq('id', productId);
    await serviceClient.auth.admin.deleteUser(userId);
  }
});
