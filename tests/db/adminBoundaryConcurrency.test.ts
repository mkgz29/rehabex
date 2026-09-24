import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import { createClient } from '@supabase/supabase-js';

// Same local-only guard as tests/db/paymentAtomicConcurrency.test.ts: this
// suite creates and deletes real rows (including an auth user) and must
// never be able to target a remote project.
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
  throw new Error('Admin boundary concurrency test requires local Supabase credentials and refuses remote URLs.');
}

const serviceClient = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });

/** Creates a real admin user and returns a client scoped to that user's own access token, matching production. */
async function createAdminUserClient() {
  const suffix = randomUUID();
  const email = `admin-01b-concurrency-${suffix}@example.test`;
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

test('two concurrent product edits: the first commits, the stale second is rejected with a conflict', async () => {
  const { userId, userScopedClient } = await createAdminUserClient();
  let productId: string | null = null;

  try {
    const { data: created, error: createError } = await userScopedClient.rpc('admin_create_product', {
      p_name: 'ADMIN-01B concurrency fixture',
      p_description: '',
      p_category: 'Ortopedia',
      p_price: 100,
      p_image_url: null,
      p_is_featured: false,
      p_display_order: 0,
      p_request_id: randomUUID(),
    });
    assert.equal(createError, null);
    productId = created.id;

    const { data: activated, error: activateError } = await userScopedClient.rpc('admin_set_product_active', {
      p_product_id: productId,
      p_is_active: true,
      p_expected_updated_at: created.updated_at,
      p_request_id: randomUUID(),
    });
    assert.equal(activateError, null);

    // The version both concurrent editors believe is current.
    const raceVersion = activated.updated_at;

    const { data: first, error: firstError } = await userScopedClient.rpc('admin_update_product', {
      p_product_id: productId,
      p_name: 'Winner writer',
      p_description: '',
      p_category: 'Ortopedia',
      p_price: 150,
      p_image_url: null,
      p_is_featured: false,
      p_display_order: 0,
      p_expected_updated_at: raceVersion,
      p_request_id: randomUUID(),
    });
    assert.equal(firstError, null);
    assert.equal(first.name, 'Winner writer');
    assert.notEqual(first.updated_at, raceVersion);

    const { data: second, error: secondError } = await userScopedClient.rpc('admin_update_product', {
      p_product_id: productId,
      p_name: 'Stale writer',
      p_description: '',
      p_category: 'Ortopedia',
      p_price: 200,
      p_image_url: null,
      p_is_featured: false,
      p_display_order: 0,
      p_expected_updated_at: raceVersion,
      p_request_id: randomUUID(),
    });
    assert.equal(second, null);
    assert.equal(secondError?.code, 'ADM09');

    const { data: final, error: finalError } = await serviceClient.from('products').select('name, price').eq('id', productId).single();
    assert.equal(finalError, null);
    assert.equal(final?.name, 'Winner writer');
    assert.equal(Number(final?.price), 150);

    // admin_audit_events grants SELECT to authenticated (gated by is_admin()
    // RLS) but no write grant to anyone, including service_role: the audit
    // trail is only ever written by the RPC itself. Read it back through the
    // admin's own client, the same path the panel would use.
    const { count, error: auditError } = await userScopedClient
      .from('admin_audit_events')
      .select('id', { count: 'exact', head: true })
      .eq('entity_id', productId)
      .eq('action', 'product.price_changed');
    assert.equal(auditError, null);
    assert.equal(count, 1);
  } finally {
    // admin_audit_events rows are append-only by design (no delete grant
    // exists for any client role); this best-effort cleanup only removes the
    // synthetic product and user, and leaves the audit trail it produced.
    if (productId) {
      await serviceClient.from('products').delete().eq('id', productId);
    }
    await serviceClient.auth.admin.deleteUser(userId);
  }
});
