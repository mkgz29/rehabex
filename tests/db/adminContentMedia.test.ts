import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import { createClient } from '@supabase/supabase-js';

import { auditCount, createAdminUserClient } from './adminProductAtomicity.test.ts';

// ADMIN-02E: image framing on the gallery, and atomic featured-products
// curation. Same local-only guard as the rest of tests/db.
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
  throw new Error('Admin content/media test requires local Supabase credentials and refuses remote URLs.');
}

const serviceClient = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });

const DEFAULT_FRAMING = { mode: 'fill', focalX: 0.5, focalY: 0.5, zoom: 1 };

async function mockFinalizedAsset(client: ReturnType<typeof createClient>) {
  const publicId = `qa/content-media-${randomUUID()}`;
  await client.rpc('admin_create_pending_media_asset', { p_public_id: publicId, p_folder: 'rehabex/products', p_request_id: randomUUID() });
  const { data, error } = await client.rpc('admin_finalize_media_asset', {
    p_public_id: publicId,
    p_secure_url: `https://res.cloudinary.com/demo/image/upload/${publicId}.jpg`,
    p_format: 'jpg',
    p_mime_type: 'image/jpeg',
    p_bytes: 100_000,
    p_width: 800,
    p_height: 800,
    p_request_id: randomUUID(),
  });
  assert.equal(error, null);
  return data.id as string;
}

function createProduct(client: ReturnType<typeof createClient>, overrides: Record<string, unknown> = {}) {
  return client.rpc('admin_create_product_with_media', {
    p_name: 'Producto ADMIN-02E',
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

async function galleryFraming(productId: string) {
  const { data, error } = await serviceClient.from('product_images').select('framing').eq('product_id', productId).single();
  assert.equal(error, null);
  return data?.framing;
}

// --- Image framing on product_images ----------------------------------------

test('a new gallery image without an explicit framing defaults to centered/fill/normal-zoom', async () => {
  const { userId, userScopedClient } = await createAdminUserClient('content-media-default-framing');
  let productId: string | null = null;
  try {
    const assetId = await mockFinalizedAsset(userScopedClient);
    const { data, error } = await createProduct(userScopedClient, { p_gallery: [{ mediaAssetId: assetId, isPrimary: true }] });
    assert.equal(error, null);
    productId = data.product.id;
    assert.deepEqual(await galleryFraming(productId), DEFAULT_FRAMING);
    assert.deepEqual(data.gallery[0].framing, DEFAULT_FRAMING);
  } finally {
    if (productId) await serviceClient.from('products').delete().eq('id', productId);
    await serviceClient.auth.admin.deleteUser(userId);
  }
});

test('a custom framing is stored and returned exactly as sent', async () => {
  const { userId, userScopedClient } = await createAdminUserClient('content-media-custom-framing');
  let productId: string | null = null;
  try {
    const assetId = await mockFinalizedAsset(userScopedClient);
    const framing = { mode: 'contain', focalX: 0.2, focalY: 0.9, zoom: 1.8 };
    const { data, error } = await createProduct(userScopedClient, { p_gallery: [{ mediaAssetId: assetId, isPrimary: true, framing }] });
    assert.equal(error, null);
    productId = data.product.id;
    assert.deepEqual(await galleryFraming(productId), framing);
  } finally {
    if (productId) await serviceClient.from('products').delete().eq('id', productId);
    await serviceClient.auth.admin.deleteUser(userId);
  }
});

test('a malformed framing is rejected, changing nothing', async () => {
  const { userId, userScopedClient } = await createAdminUserClient('content-media-invalid-framing');
  try {
    const assetId = await mockFinalizedAsset(userScopedClient);
    const { data, error } = await createProduct(userScopedClient, {
      p_gallery: [{ mediaAssetId: assetId, isPrimary: true, framing: { mode: 'fill', focalX: 5, focalY: 0.5, zoom: 1 } }],
    });
    assert.equal(data, null);
    assert.equal(error?.code, 'ADM22');
  } finally {
    await serviceClient.auth.admin.deleteUser(userId);
  }
});

test('editing only text fields preserves the gallery framing exactly', async () => {
  const { userId, userScopedClient } = await createAdminUserClient('content-media-text-edit-preserves-framing');
  let productId: string | null = null;
  try {
    const assetId = await mockFinalizedAsset(userScopedClient);
    const framing = { mode: 'fill', focalX: 0.1, focalY: 0.3, zoom: 2 };
    const { data: created } = await createProduct(userScopedClient, { p_gallery: [{ mediaAssetId: assetId, isPrimary: true, framing }] });
    productId = created.product.id;

    const { data: updated, error } = await userScopedClient.rpc('admin_update_product_with_media', {
      p_product_id: productId,
      p_name: 'Nombre editado',
      p_description: '',
      p_category: 'Ortopedia',
      p_price: 100,
      p_is_featured: false,
      p_display_order: 0,
      p_is_active: false,
      p_gallery: [{ mediaAssetId: assetId, isPrimary: true, framing }],
      p_expected_updated_at: created.product.updated_at,
      p_request_id: randomUUID(),
    });
    assert.equal(error, null);
    assert.equal(updated.product.name, 'Nombre editado');
    assert.deepEqual(await galleryFraming(productId), framing, 'the framing must survive an unrelated content edit');
  } finally {
    if (productId) await serviceClient.from('products').delete().eq('id', productId);
    await serviceClient.auth.admin.deleteUser(userId);
  }
});

// --- Featured products curation ----------------------------------------------

test('admin_set_featured_products atomically marks products featured with a chosen order', async () => {
  const { userId, userScopedClient } = await createAdminUserClient('content-media-featured-atomic');
  let productAId: string | null = null;
  let productBId: string | null = null;
  try {
    const { data: a } = await createProduct(userScopedClient, { p_name: 'Producto A', p_is_active: true });
    const { data: b } = await createProduct(userScopedClient, { p_name: 'Producto B', p_is_active: true });
    productAId = a.product.id;
    productBId = b.product.id;

    // entity_id is the constant "bulk" for every call to this RPC (there is
    // no single product id for a multi-product operation), so other tests in
    // this same run also contribute rows under it -- assert the delta this
    // call adds, not an absolute count.
    const auditBefore = await auditCount(userScopedClient, 'bulk', 'products.featured_updated');

    const { data, error } = await userScopedClient.rpc('admin_set_featured_products', {
      p_items: [
        { id: productAId, isFeatured: true, displayOrder: 0 },
        { id: productBId, isFeatured: true, displayOrder: 1 },
      ],
      p_request_id: randomUUID(),
    });
    assert.equal(error, null);
    assert.equal(data.updated, 2);

    const { data: rows } = await serviceClient.from('products').select('id, is_featured, display_order').in('id', [productAId, productBId]).order('display_order');
    assert.deepEqual(
      rows?.map((row) => ({ id: row.id, featured: row.is_featured, order: row.display_order })),
      [
        { id: productAId, featured: true, order: 0 },
        { id: productBId, featured: true, order: 1 },
      ],
    );
    const auditAfter = await auditCount(userScopedClient, 'bulk', 'products.featured_updated');
    assert.equal(auditAfter - auditBefore, 1);
  } finally {
    if (productAId) await serviceClient.from('products').delete().eq('id', productAId);
    if (productBId) await serviceClient.from('products').delete().eq('id', productBId);
    await serviceClient.auth.admin.deleteUser(userId);
  }
});

test('admin_set_featured_products refuses to feature a hidden product, changing nothing', async () => {
  const { userId, userScopedClient } = await createAdminUserClient('content-media-featured-hidden');
  let productId: string | null = null;
  try {
    const { data: created } = await createProduct(userScopedClient, { p_is_active: false });
    productId = created.product.id;

    const { data, error } = await userScopedClient.rpc('admin_set_featured_products', {
      p_items: [{ id: productId, isFeatured: true, displayOrder: 0 }],
      p_request_id: randomUUID(),
    });
    assert.equal(data, null);
    assert.equal(error?.code, 'ADM22');

    const { data: row } = await serviceClient.from('products').select('is_featured').eq('id', productId).single();
    assert.equal(row?.is_featured, false);
  } finally {
    if (productId) await serviceClient.from('products').delete().eq('id', productId);
    await serviceClient.auth.admin.deleteUser(userId);
  }
});

test('admin_set_featured_products refuses to feature a TEST/PRUEBA-category product', async () => {
  const { userId, userScopedClient } = await createAdminUserClient('content-media-featured-test-category');
  let productId: string | null = null;
  try {
    // admin_create_product itself rejects a TEST/PRUEBA category outright, so
    // a fixture in that shape (like the real TEST-MP products) can only ever
    // exist as data seeded directly, never through the RPC -- inserted here
    // the same way to reproduce that real shape.
    const { data: inserted, error: insertError } = await serviceClient
      .from('products')
      .insert({ name: 'Producto TEST fixture', description: '', category: 'TEST', price: 1, is_active: true, display_order: 0 })
      .select('id')
      .single();
    assert.equal(insertError, null);
    productId = inserted?.id;

    const { data, error } = await userScopedClient.rpc('admin_set_featured_products', {
      p_items: [{ id: productId, isFeatured: true, displayOrder: 0 }],
      p_request_id: randomUUID(),
    });
    assert.equal(data, null);
    assert.equal(error?.code, 'ADM22');
  } finally {
    if (productId) await serviceClient.from('products').delete().eq('id', productId);
    await serviceClient.auth.admin.deleteUser(userId);
  }
});

test('admin_set_featured_products only touches the products explicitly listed', async () => {
  const { userId, userScopedClient } = await createAdminUserClient('content-media-featured-scoped');
  let productAId: string | null = null;
  let productBId: string | null = null;
  try {
    const { data: a } = await createProduct(userScopedClient, { p_name: 'Producto A', p_display_order: 42, p_is_active: true });
    const { data: b } = await createProduct(userScopedClient, { p_name: 'Producto B', p_display_order: 99, p_is_active: true });
    productAId = a.product.id;
    productBId = b.product.id;

    await userScopedClient.rpc('admin_set_featured_products', {
      p_items: [{ id: productAId, isFeatured: true, displayOrder: 0 }],
      p_request_id: randomUUID(),
    });

    const { data: untouched } = await serviceClient.from('products').select('is_featured, display_order').eq('id', productBId).single();
    assert.equal(untouched?.is_featured, false);
    assert.equal(untouched?.display_order, 99, 'a product not listed in the call must keep its own order untouched');
  } finally {
    if (productAId) await serviceClient.from('products').delete().eq('id', productAId);
    if (productBId) await serviceClient.from('products').delete().eq('id', productBId);
    await serviceClient.auth.admin.deleteUser(userId);
  }
});

test('a non-admin cannot set featured products', async () => {
  const suffix = randomUUID();
  const email = `content-media-nonadmin-${suffix}@example.test`;
  const password = `Pw-${suffix}`;
  const { data: created } = await serviceClient.auth.admin.createUser({ email, password, email_confirm: true });
  const userId = created.user?.id as string;
  try {
    const anon = createClient(supabaseUrl, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: session } = await anon.auth.signInWithPassword({ email, password });
    const token = session.session?.access_token as string;
    const userScopedClient = createClient(supabaseUrl, anonKey, { auth: { persistSession: false, autoRefreshToken: false }, global: { headers: { Authorization: `Bearer ${token}` } } });

    const { data, error } = await userScopedClient.rpc('admin_set_featured_products', {
      p_items: [{ id: randomUUID(), isFeatured: true, displayOrder: 0 }],
      p_request_id: randomUUID(),
    });
    assert.equal(data, null);
    assert.equal(error?.code, 'ADM03');
  } finally {
    await serviceClient.auth.admin.deleteUser(userId);
  }
});
