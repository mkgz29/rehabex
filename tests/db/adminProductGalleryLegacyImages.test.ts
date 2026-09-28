import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import { createClient } from '@supabase/supabase-js';

import { auditCount, createAdminUserClient } from './adminProductAtomicity.test.ts';

// RELEASE-ADMIN-02-PREFLIGHT: covers the legacy-image compatibility fix in
// 202609250101_admin_02c_product_gallery.sql. Every product created before
// that migration keeps its image only in products.image_url with zero
// product_images rows; the migration backfills one product_images row per
// such product (media_asset_id NULL) so admin_sync_product_gallery -- which
// always recomputes products.image_url from the gallery -- does not
// silently null it out on the product's next content-only edit. Same
// local-only guard as the rest of tests/db.
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
  throw new Error('Admin product gallery legacy-image test requires local Supabase credentials and refuses remote URLs.');
}

const serviceClient = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });

async function mockFinalizedAsset(client: ReturnType<typeof createClient>) {
  const publicId = `qa/legacy-${randomUUID()}`;
  const { error: signError } = await client.rpc('admin_create_pending_media_asset', {
    p_public_id: publicId,
    p_folder: 'rehabex/products',
    p_request_id: randomUUID(),
  });
  assert.equal(signError, null);

  const { data: finalized, error: finalizeError } = await client.rpc('admin_finalize_media_asset', {
    p_public_id: publicId,
    p_secure_url: `https://res.cloudinary.com/demo/image/upload/${publicId}.jpg`,
    p_format: 'jpg',
    p_mime_type: 'image/jpeg',
    p_bytes: 100_000,
    p_width: 800,
    p_height: 800,
    p_request_id: randomUUID(),
  });
  assert.equal(finalizeError, null);
  return finalized.id as string;
}

function updateProduct(client: ReturnType<typeof createClient>, overrides: Record<string, unknown>) {
  return client.rpc('admin_update_product_with_media', {
    p_name: 'Producto heredado',
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

async function galleryRows(productId: string) {
  const { data, error } = await serviceClient
    .from('product_images')
    .select('media_asset_id, url, display_order, is_primary')
    .eq('product_id', productId)
    .order('display_order', { ascending: true });
  assert.equal(error, null);
  return data ?? [];
}

async function productImageUrl(productId: string) {
  const { data, error } = await serviceClient.from('products').select('image_url, image_asset_id, name, price').eq('id', productId).single();
  assert.equal(error, null);
  return data;
}

/**
 * Builds a product in exactly the shape every pre-ADMIN-02C production
 * product has before the migration's backfill runs: a real image_url, zero
 * product_images rows. Then applies the same backfill the migration performs
 * (one product_images row, media_asset_id NULL, is_primary true), so the
 * rest of each test exercises the RPC exactly as it behaves against a real,
 * already-backfilled legacy product.
 */
async function createLegacyProduct(userScopedClient: ReturnType<typeof createClient>) {
  const legacyUrl = `https://res.cloudinary.com/demo/image/upload/legacy-${randomUUID()}.jpg`;

  const { data: created, error } = await userScopedClient.rpc('admin_create_product_with_media', {
    p_name: 'Producto heredado',
    p_description: '',
    p_category: 'Ortopedia',
    p_price: 100,
    p_is_featured: false,
    p_display_order: 0,
    p_is_active: false,
    p_gallery: [],
    p_request_id: randomUUID(),
  });
  assert.equal(error, null);
  const productId = created.product.id as string;

  // Simulates the pre-migration production row: image only in
  // products.image_url, no representation in product_images yet.
  const { error: seedError } = await serviceClient.from('products').update({ image_url: legacyUrl }).eq('id', productId);
  assert.equal(seedError, null);

  const beforeBackfill = await galleryRows(productId);
  assert.equal(beforeBackfill.length, 0, 'sanity: a legacy product starts with zero product_images rows');

  // The migration's one-time backfill INSERT, reproduced here so this test
  // exercises the exact row shape it produces without re-running DDL.
  const { error: backfillError } = await serviceClient
    .from('product_images')
    .insert({ product_id: productId, media_asset_id: null, url: legacyUrl, display_order: 0, is_primary: true });
  assert.equal(backfillError, null);

  return { productId, legacyUrl };
}

test('before the backfill, a legacy product has its image only in products.image_url and zero product_images rows', async () => {
  const { userId, userScopedClient } = await createAdminUserClient('legacy-pre');
  let productId: string | null = null;
  try {
    const legacyUrl = `https://res.cloudinary.com/demo/image/upload/legacy-${randomUUID()}.jpg`;
    const { data: created } = await userScopedClient.rpc('admin_create_product_with_media', {
      p_name: 'Producto heredado',
      p_description: '',
      p_category: 'Ortopedia',
      p_price: 100,
      p_is_featured: false,
      p_display_order: 0,
      p_is_active: false,
      p_gallery: [],
      p_request_id: randomUUID(),
    });
    productId = created.product.id;
    await serviceClient.from('products').update({ image_url: legacyUrl }).eq('id', productId);

    const product = await productImageUrl(productId);
    assert.equal(product?.image_url, legacyUrl);
    assert.equal((await galleryRows(productId)).length, 0);
  } finally {
    if (productId) await serviceClient.from('products').delete().eq('id', productId);
    await serviceClient.auth.admin.deleteUser(userId);
  }
});

test('the backfill produces a coherent legacy gallery row: media_asset_id NULL, primary, matching URL', async () => {
  const { userId, userScopedClient } = await createAdminUserClient('legacy-backfill');
  let productId: string | null = null;
  try {
    const legacy = await createLegacyProduct(userScopedClient);
    productId = legacy.productId;

    const rows = await galleryRows(productId);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].media_asset_id, null);
    assert.equal(rows[0].is_primary, true);
    assert.equal(rows[0].url, legacy.legacyUrl);
  } finally {
    if (productId) await serviceClient.from('products').delete().eq('id', productId);
    await serviceClient.auth.admin.deleteUser(userId);
  }
});

test('editing only text fields (name, description, price, category) does not lose the legacy image', async () => {
  const { userId, userScopedClient } = await createAdminUserClient('legacy-text-edit');
  let productId: string | null = null;
  try {
    const legacy = await createLegacyProduct(userScopedClient);
    productId = legacy.productId;

    const { data: before } = await serviceClient.from('products').select('updated_at').eq('id', productId).single();
    const { data: result, error: updateError } = await updateProduct(userScopedClient, {
      p_product_id: productId,
      p_name: 'Producto heredado editado',
      p_price: 150,
      p_gallery: [{ legacyUrl: legacy.legacyUrl, isPrimary: true }],
      p_expected_updated_at: before?.updated_at,
    });
    assert.equal(updateError, null);
    assert.equal(result.product.name, 'Producto heredado editado');
    assert.equal(Number(result.product.price), 150);
    assert.equal(result.product.image_url, legacy.legacyUrl, 'the legacy image must survive a content-only edit');

    const rows = await galleryRows(productId);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].media_asset_id, null);
    assert.equal(rows[0].url, legacy.legacyUrl);
  } finally {
    if (productId) await serviceClient.from('products').delete().eq('id', productId);
    await serviceClient.auth.admin.deleteUser(userId);
  }
});

test('changing visibility (is_active) does not lose the legacy image', async () => {
  const { userId, userScopedClient } = await createAdminUserClient('legacy-visibility');
  let productId: string | null = null;
  try {
    const legacy = await createLegacyProduct(userScopedClient);
    productId = legacy.productId;

    const { data: current } = await serviceClient.from('products').select('updated_at').eq('id', productId).single();
    const { data: result, error } = await updateProduct(userScopedClient, {
      p_product_id: productId,
      p_name: 'Producto heredado',
      p_category: 'Ortopedia',
      p_price: 100,
      p_is_active: true,
      p_gallery: [{ legacyUrl: legacy.legacyUrl, isPrimary: true }],
      p_expected_updated_at: current?.updated_at,
    });
    assert.equal(error, null);
    assert.equal(result.product.is_active, true);
    assert.equal(result.product.image_url, legacy.legacyUrl, 'toggling visibility must not touch the legacy image');
  } finally {
    if (productId) await serviceClient.from('products').delete().eq('id', productId);
    await serviceClient.auth.admin.deleteUser(userId);
  }
});

test('saving with the gallery echoed back unchanged conserves exactly the same legacy row', async () => {
  const { userId, userScopedClient } = await createAdminUserClient('legacy-noop-save');
  let productId: string | null = null;
  try {
    const legacy = await createLegacyProduct(userScopedClient);
    productId = legacy.productId;

    const { data: current } = await serviceClient.from('products').select('updated_at').eq('id', productId).single();
    const { error } = await updateProduct(userScopedClient, {
      p_product_id: productId,
      p_gallery: [{ legacyUrl: legacy.legacyUrl, isPrimary: true }],
      p_expected_updated_at: current?.updated_at,
    });
    assert.equal(error, null);

    const rows = await galleryRows(productId);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].url, legacy.legacyUrl);
    assert.equal(rows[0].is_primary, true);
    const product = await productImageUrl(productId);
    assert.equal(product?.image_url, legacy.legacyUrl);
  } finally {
    if (productId) await serviceClient.from('products').delete().eq('id', productId);
    await serviceClient.auth.admin.deleteUser(userId);
  }
});

test('replacing a legacy image with a media_assets-managed image works and drops the legacy row', async () => {
  const { userId, userScopedClient } = await createAdminUserClient('legacy-replace');
  let productId: string | null = null;
  try {
    const legacy = await createLegacyProduct(userScopedClient);
    productId = legacy.productId;
    const newAssetId = await mockFinalizedAsset(userScopedClient);

    const { data: current } = await serviceClient.from('products').select('updated_at').eq('id', productId).single();
    const { data: result, error } = await updateProduct(userScopedClient, {
      p_product_id: productId,
      p_gallery: [{ mediaAssetId: newAssetId, isPrimary: true }],
      p_expected_updated_at: current?.updated_at,
    });
    assert.equal(error, null);
    assert.equal(result.product.image_asset_id, newAssetId);
    assert.notEqual(result.product.image_url, legacy.legacyUrl);

    const rows = await galleryRows(productId);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].media_asset_id, newAssetId);
  } finally {
    if (productId) await serviceClient.from('products').delete().eq('id', productId);
    await serviceClient.auth.admin.deleteUser(userId);
  }
});

test('deliberately removing the legacy image (empty gallery) does clear it', async () => {
  const { userId, userScopedClient } = await createAdminUserClient('legacy-remove');
  let productId: string | null = null;
  try {
    const legacy = await createLegacyProduct(userScopedClient);
    productId = legacy.productId;

    const { data: current } = await serviceClient.from('products').select('updated_at').eq('id', productId).single();
    const { data: result, error } = await updateProduct(userScopedClient, {
      p_product_id: productId,
      p_gallery: [],
      p_expected_updated_at: current?.updated_at,
    });
    assert.equal(error, null);
    assert.equal(result.product.image_url, null);
    assert.equal(result.product.image_asset_id, null);
    assert.equal((await galleryRows(productId)).length, 0);
  } finally {
    if (productId) await serviceClient.from('products').delete().eq('id', productId);
    await serviceClient.auth.admin.deleteUser(userId);
  }
});

test('an arbitrary legacyUrl that does not match an existing legacy row is rejected, changing nothing', async () => {
  const { userId, userScopedClient } = await createAdminUserClient('legacy-fabricated');
  let productId: string | null = null;
  try {
    const legacy = await createLegacyProduct(userScopedClient);
    productId = legacy.productId;

    const { data: current } = await serviceClient.from('products').select('updated_at').eq('id', productId).single();
    const { data: result, error } = await updateProduct(userScopedClient, {
      p_product_id: productId,
      p_name: 'No deberia aplicarse',
      p_gallery: [{ legacyUrl: 'https://attacker.example.test/fake.jpg', isPrimary: true }],
      p_expected_updated_at: current?.updated_at,
    });
    assert.equal(result, null);
    assert.equal(error?.code, 'ADM22');

    const product = await productImageUrl(productId);
    assert.equal(product?.image_url, legacy.legacyUrl, 'a fabricated legacyUrl must never overwrite the real image');
    assert.notEqual(product?.name, 'No deberia aplicarse');
    const rows = await galleryRows(productId);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].url, legacy.legacyUrl);
  } finally {
    if (productId) await serviceClient.from('products').delete().eq('id', productId);
    await serviceClient.auth.admin.deleteUser(userId);
  }
});

test('retrying the same legacy gallery submission twice never duplicates the row', async () => {
  const { userId, userScopedClient } = await createAdminUserClient('legacy-retry');
  let productId: string | null = null;
  try {
    const legacy = await createLegacyProduct(userScopedClient);
    productId = legacy.productId;

    const { data: current } = await serviceClient.from('products').select('updated_at').eq('id', productId).single();
    const gallery = [{ legacyUrl: legacy.legacyUrl, isPrimary: true }];

    const { error: firstError } = await updateProduct(userScopedClient, {
      p_product_id: productId,
      p_gallery: gallery,
      p_expected_updated_at: current?.updated_at,
    });
    assert.equal(firstError, null);

    const { data: afterFirst } = await serviceClient.from('products').select('updated_at').eq('id', productId).single();
    const { error: secondError } = await updateProduct(userScopedClient, {
      p_product_id: productId,
      p_gallery: gallery,
      p_expected_updated_at: afterFirst?.updated_at,
    });
    assert.equal(secondError, null);

    const rows = await galleryRows(productId);
    assert.equal(rows.length, 1, 'the legacy row must never be duplicated across retries');
  } finally {
    if (productId) await serviceClient.from('products').delete().eq('id', productId);
    await serviceClient.auth.admin.deleteUser(userId);
  }
});

test('a failed update (invalid gallery) rolls back the whole transaction, including name and price', async () => {
  const { userId, userScopedClient } = await createAdminUserClient('legacy-rollback');
  let productId: string | null = null;
  try {
    const legacy = await createLegacyProduct(userScopedClient);
    productId = legacy.productId;

    const { data: current } = await serviceClient.from('products').select('updated_at').eq('id', productId).single();
    const { data: failed, error } = await updateProduct(userScopedClient, {
      p_product_id: productId,
      p_name: 'No deberia persistir',
      p_price: 999,
      p_gallery: [
        { legacyUrl: legacy.legacyUrl, isPrimary: true },
        { legacyUrl: legacy.legacyUrl, isPrimary: false },
      ], // duplicate legacyUrl -> rejected
      p_expected_updated_at: current?.updated_at,
    });
    assert.equal(failed, null);
    assert.equal(error?.code, 'ADM22');

    const product = await productImageUrl(productId);
    assert.equal(product?.name, 'Producto heredado', 'name must roll back together with the rejected gallery');
    assert.equal(Number(product?.price), 100);
    assert.equal(product?.image_url, legacy.legacyUrl);

    const rows = await galleryRows(productId);
    assert.equal(rows.length, 1);
    assert.equal(await auditCount(userScopedClient, productId, 'product.gallery_updated'), 0, 'a rolled-back attempt logs no audit event');
  } finally {
    if (productId) await serviceClient.from('products').delete().eq('id', productId);
    await serviceClient.auth.admin.deleteUser(userId);
  }
});
