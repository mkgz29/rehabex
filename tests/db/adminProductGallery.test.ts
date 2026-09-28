import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import { createClient } from '@supabase/supabase-js';

import { auditCount, createAdminUserClient } from './adminProductAtomicity.test.ts';

// Same local-only guard as the rest of the tests/db suite. Cloudinary is
// never called here: a "finalized upload" is simulated by calling the real
// admin_create_pending_media_asset / admin_finalize_media_asset RPCs with
// made-up (but policy-valid) metadata -- zero real uploads.
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
  throw new Error('Admin product gallery test requires local Supabase credentials and refuses remote URLs.');
}

const serviceClient = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });

// media_assets revokes ALL table access from every client role including
// service_role (see admin_01c_secure_media.sql: "every writer is a SECURITY
// DEFINER RPC"), so a "finalized upload" can only be simulated by actually
// calling admin_create_pending_media_asset + admin_finalize_media_asset as
// the owning admin -- never a direct table insert. Zero Cloudinary calls:
// finalize only validates the parameters given to it, it never contacts
// Cloudinary itself (that check lives in the HTTP handler layer, which these
// RPC-level tests bypass entirely, same as every other test in this file).
async function mockFinalizedAsset(client: ReturnType<typeof createClient>, overrides: Record<string, unknown> = {}) {
  const publicId = `qa/gallery-${randomUUID()}`;
  const { data: pending, error: signError } = await client.rpc('admin_create_pending_media_asset', {
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
    ...overrides,
  });
  assert.equal(finalizeError, null);
  return finalized.id as string;
}

/** For the "never finalized" test: signs but deliberately never finalizes, leaving status 'authorized'. */
async function mockAuthorizedOnlyAsset(client: ReturnType<typeof createClient>) {
  const publicId = `qa/gallery-unfinalized-${randomUUID()}`;
  const { data, error } = await client.rpc('admin_create_pending_media_asset', {
    p_public_id: publicId,
    p_folder: 'rehabex/products',
    p_request_id: randomUUID(),
  });
  assert.equal(error, null);
  return data.id as string;
}

function createProduct(client: ReturnType<typeof createClient>, overrides: Record<string, unknown> = {}) {
  return client.rpc('admin_create_product_with_media', {
    p_name: 'Producto de galeria',
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
    p_name: 'Producto de galeria',
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
    .select('media_asset_id, display_order, is_primary')
    .eq('product_id', productId)
    .order('display_order', { ascending: true });
  assert.equal(error, null);
  return data ?? [];
}

// media_assets grants SELECT only to authenticated (is_admin()-gated RLS),
// not service_role -- same reasoning as auditCount in adminProductAtomicity.
async function assetStatus(client: ReturnType<typeof createClient>, assetId: string) {
  const { data, error } = await client.from('media_assets').select('status').eq('id', assetId).single();
  assert.equal(error, null);
  return data?.status as string;
}

// --- 0, 1, 5 images; rejection of a 6th ------------------------------------------

test('a product can be created with zero images', async () => {
  const { userId, userScopedClient } = await createAdminUserClient();
  let productId: string | null = null;
  try {
    const { data, error } = await createProduct(userScopedClient);
    assert.equal(error, null);
    productId = data.product.id;
    assert.deepEqual(data.gallery, []);
    assert.equal(data.product.image_asset_id, null);
    assert.equal(await galleryRows(productId).then((rows) => rows.length), 0);
  } finally {
    if (productId) await serviceClient.from('products').delete().eq('id', productId);
    await serviceClient.auth.admin.deleteUser(userId);
  }
});

test('a product can be created with exactly one image, which becomes primary and syncs products.image_asset_id', async () => {
  const { userId, userScopedClient } = await createAdminUserClient();
  let productId: string | null = null;
  try {
    const assetId = await mockFinalizedAsset(userScopedClient);
    const { data, error } = await createProduct(userScopedClient, { p_gallery: [{ mediaAssetId: assetId, isPrimary: true }] });
    assert.equal(error, null);
    productId = data.product.id;
    assert.equal(data.product.image_asset_id, assetId);
    assert.equal(data.gallery.length, 1);
    assert.equal(data.gallery[0].isPrimary, true);
    assert.equal(await assetStatus(userScopedClient, assetId), 'attached');
  } finally {
    if (productId) await serviceClient.from('products').delete().eq('id', productId);
    await serviceClient.auth.admin.deleteUser(userId);
  }
});

test('a product can be created with exactly five images', async () => {
  const { userId, userScopedClient } = await createAdminUserClient();
  let productId: string | null = null;
  try {
    const assetIds = await Promise.all(Array.from({ length: 5 }, () => mockFinalizedAsset(userScopedClient)));
    const gallery = assetIds.map((mediaAssetId, i) => ({ mediaAssetId, isPrimary: i === 0 }));
    const { data, error } = await createProduct(userScopedClient, { p_gallery: gallery });
    assert.equal(error, null);
    productId = data.product.id;
    assert.equal(data.gallery.length, 5);
    const rows = await galleryRows(productId);
    assert.deepEqual(rows.map((r) => r.display_order), [0, 1, 2, 3, 4]);
  } finally {
    if (productId) await serviceClient.from('products').delete().eq('id', productId);
    await serviceClient.auth.admin.deleteUser(userId);
  }
});

test('a sixth image is rejected directly by the RPC, independent of any client-side check', async () => {
  const { userId, userScopedClient } = await createAdminUserClient();
  try {
    const assetIds = await Promise.all(Array.from({ length: 6 }, () => mockFinalizedAsset(userScopedClient)));
    const gallery = assetIds.map((mediaAssetId, i) => ({ mediaAssetId, isPrimary: i === 0 }));
    const { data, error } = await createProduct(userScopedClient, { p_gallery: gallery });
    assert.equal(data, null);
    assert.equal(error?.code, 'ADM22');
  } finally {
    await serviceClient.auth.admin.deleteUser(userId);
  }
});

// --- duplicate ids, invalid/foreign assets, primary rules ------------------------

test('a duplicated mediaAssetId within the same gallery is rejected', async () => {
  const { userId, userScopedClient } = await createAdminUserClient();
  try {
    const assetId = await mockFinalizedAsset(userScopedClient);
    const { data, error } = await createProduct(userScopedClient, {
      p_gallery: [
        { mediaAssetId: assetId, isPrimary: true },
        { mediaAssetId: assetId, isPrimary: false },
      ],
    });
    assert.equal(data, null);
    assert.equal(error?.code, 'ADM22');
  } finally {
    await serviceClient.auth.admin.deleteUser(userId);
  }
});

test('a nonexistent mediaAssetId is rejected as not found', async () => {
  const { userId, userScopedClient } = await createAdminUserClient();
  try {
    const { data, error } = await createProduct(userScopedClient, { p_gallery: [{ mediaAssetId: randomUUID(), isPrimary: true }] });
    assert.equal(data, null);
    assert.equal(error?.code, 'ADM04');
  } finally {
    await serviceClient.auth.admin.deleteUser(userId);
  }
});

test('an asset that was never finalized (still "authorized") is rejected', async () => {
  const { userId, userScopedClient } = await createAdminUserClient();
  try {
    const assetId = await mockAuthorizedOnlyAsset(userScopedClient);
    const { data, error } = await createProduct(userScopedClient, { p_gallery: [{ mediaAssetId: assetId, isPrimary: true }] });
    assert.equal(data, null);
    assert.equal(error?.code, 'ADM22');
  } finally {
    await serviceClient.auth.admin.deleteUser(userId);
  }
});

test('an asset already attached to a different product is rejected', async () => {
  const { userId, userScopedClient } = await createAdminUserClient();
  let firstProductId: string | null = null;
  try {
    const sharedAsset = await mockFinalizedAsset(userScopedClient);
    const { data: first } = await createProduct(userScopedClient, { p_gallery: [{ mediaAssetId: sharedAsset, isPrimary: true }] });
    firstProductId = first.product.id;

    const { data: second, error: secondError } = await createProduct(userScopedClient, {
      p_name: 'Segundo producto',
      p_gallery: [{ mediaAssetId: sharedAsset, isPrimary: true }],
    });
    assert.equal(second, null);
    assert.equal(secondError?.code, 'ADM22');
  } finally {
    if (firstProductId) await serviceClient.from('products').delete().eq('id', firstProductId);
    await serviceClient.auth.admin.deleteUser(userId);
  }
});

test('an asset owned by a different admin is rejected as forbidden', async () => {
  const owner = await createAdminUserClient('gallery-owner');
  const other = await createAdminUserClient('gallery-other');
  try {
    const assetId = await mockFinalizedAsset(owner.userScopedClient);
    const { data, error } = await createProduct(other.userScopedClient, { p_gallery: [{ mediaAssetId: assetId, isPrimary: true }] });
    assert.equal(data, null);
    assert.equal(error?.code, 'ADM03');
  } finally {
    await serviceClient.auth.admin.deleteUser(owner.userId);
    await serviceClient.auth.admin.deleteUser(other.userId);
  }
});

test('a non-empty gallery with zero or with two primary images is rejected', async () => {
  const { userId, userScopedClient } = await createAdminUserClient();
  try {
    const [assetA, assetB] = await Promise.all([mockFinalizedAsset(userScopedClient), mockFinalizedAsset(userScopedClient)]);

    const zeroPrimary = await createProduct(userScopedClient, {
      p_gallery: [
        { mediaAssetId: assetA, isPrimary: false },
        { mediaAssetId: assetB, isPrimary: false },
      ],
    });
    assert.equal(zeroPrimary.data, null);
    assert.equal(zeroPrimary.error?.code, 'ADM22');

    const twoPrimary = await createProduct(userScopedClient, {
      p_gallery: [
        { mediaAssetId: assetA, isPrimary: true },
        { mediaAssetId: assetB, isPrimary: true },
      ],
    });
    assert.equal(twoPrimary.data, null);
    assert.equal(twoPrimary.error?.code, 'ADM22');
  } finally {
    await serviceClient.auth.admin.deleteUser(userId);
  }
});

// --- reordering, changing/removing primary, removing the last image -------------

test('reordering the gallery on edit persists the new display_order', async () => {
  const { userId, userScopedClient } = await createAdminUserClient();
  let productId: string | null = null;
  try {
    const [assetA, assetB] = await Promise.all([mockFinalizedAsset(userScopedClient), mockFinalizedAsset(userScopedClient)]);
    const { data: created } = await createProduct(userScopedClient, {
      p_gallery: [
        { mediaAssetId: assetA, isPrimary: true },
        { mediaAssetId: assetB, isPrimary: false },
      ],
    });
    productId = created.product.id;

    const { data: edited, error } = await updateProduct(userScopedClient, {
      p_product_id: productId,
      p_gallery: [
        { mediaAssetId: assetB, isPrimary: true },
        { mediaAssetId: assetA, isPrimary: false },
      ],
      p_expected_updated_at: created.product.updated_at,
    });
    assert.equal(error, null);
    assert.equal(edited.product.image_asset_id, assetB, 'the new primary must sync to products.image_asset_id');

    const rows = await galleryRows(productId);
    assert.deepEqual(
      rows.map((r) => [r.media_asset_id, r.display_order, r.is_primary]),
      [
        [assetB, 0, true],
        [assetA, 1, false],
      ],
    );
  } finally {
    if (productId) await serviceClient.from('products').delete().eq('id', productId);
    await serviceClient.auth.admin.deleteUser(userId);
  }
});

test('removing the last remaining image clears products.image_asset_id and image_url', async () => {
  const { userId, userScopedClient } = await createAdminUserClient();
  let productId: string | null = null;
  try {
    const assetId = await mockFinalizedAsset(userScopedClient);
    const { data: created } = await createProduct(userScopedClient, { p_gallery: [{ mediaAssetId: assetId, isPrimary: true }] });
    productId = created.product.id;

    const { data: edited, error } = await updateProduct(userScopedClient, {
      p_product_id: productId,
      p_gallery: [],
      p_expected_updated_at: created.product.updated_at,
    });
    assert.equal(error, null);
    assert.equal(edited.product.image_asset_id, null);
    assert.equal(edited.product.image_url, null);
    assert.equal(await galleryRows(productId).then((rows) => rows.length), 0);
    assert.equal(await assetStatus(userScopedClient, assetId), 'orphan_candidate');
  } finally {
    if (productId) await serviceClient.from('products').delete().eq('id', productId);
    await serviceClient.auth.admin.deleteUser(userId);
  }
});

// --- rollback, concurrency, retry, audit -----------------------------------------

test('an invalid gallery in an edit rolls back content changes too, leaving the previous gallery intact', async () => {
  const { userId, userScopedClient } = await createAdminUserClient();
  let productId: string | null = null;
  try {
    const assetId = await mockFinalizedAsset(userScopedClient);
    const { data: created } = await createProduct(userScopedClient, { p_name: 'Antes', p_gallery: [{ mediaAssetId: assetId, isPrimary: true }] });
    productId = created.product.id;

    const { data: failed, error } = await updateProduct(userScopedClient, {
      p_product_id: productId,
      p_name: 'No deberia quedar',
      p_price: 999,
      p_gallery: [
        { mediaAssetId: assetId, isPrimary: true },
        { mediaAssetId: assetId, isPrimary: false },
      ], // duplicate -> rejected
      p_expected_updated_at: created.product.updated_at,
    });
    assert.equal(failed, null);
    assert.equal(error?.code, 'ADM22');

    const { data: fromDb } = await serviceClient.from('products').select('name, price, updated_at').eq('id', productId).single();
    assert.equal(fromDb?.name, 'Antes', 'content must roll back together with the rejected gallery');
    assert.equal(Number(fromDb?.price), 100);
    assert.equal(fromDb?.updated_at, created.product.updated_at);

    const rows = await galleryRows(productId);
    assert.equal(rows.length, 1, 'the previous gallery must remain exactly as it was');
    assert.equal(rows[0].media_asset_id, assetId);
  } finally {
    if (productId) await serviceClient.from('products').delete().eq('id', productId);
    await serviceClient.auth.admin.deleteUser(userId);
  }
});

test('retrying a rejected gallery edit does not duplicate rows in product_images', async () => {
  const { userId, userScopedClient } = await createAdminUserClient();
  let productId: string | null = null;
  try {
    const assetId = await mockFinalizedAsset(userScopedClient);
    const { data: created } = await createProduct(userScopedClient, { p_gallery: [{ mediaAssetId: assetId, isPrimary: true }] });
    productId = created.product.id;

    await updateProduct(userScopedClient, {
      p_product_id: productId,
      p_gallery: [
        { mediaAssetId: assetId, isPrimary: true },
        { mediaAssetId: assetId, isPrimary: false },
      ],
      p_expected_updated_at: created.product.updated_at,
    });

    const { data: retried, error } = await updateProduct(userScopedClient, {
      p_product_id: productId,
      p_gallery: [{ mediaAssetId: assetId, isPrimary: true }],
      p_expected_updated_at: created.product.updated_at,
    });
    assert.equal(error, null);
    assert.equal(retried.gallery.length, 1);

    const rows = await galleryRows(productId);
    assert.equal(rows.length, 1, 'the failed attempt must never have left a duplicate row behind');
  } finally {
    if (productId) await serviceClient.from('products').delete().eq('id', productId);
    await serviceClient.auth.admin.deleteUser(userId);
  }
});

test('a gallery concurrency conflict changes nothing: the stale request is rejected wholesale', async () => {
  const { userId, userScopedClient } = await createAdminUserClient();
  let productId: string | null = null;
  try {
    const [assetA, assetB] = await Promise.all([mockFinalizedAsset(userScopedClient), mockFinalizedAsset(userScopedClient)]);
    const { data: created } = await createProduct(userScopedClient, { p_gallery: [{ mediaAssetId: assetA, isPrimary: true }] });
    productId = created.product.id;
    const staleVersion = created.product.updated_at;

    const { data: winner } = await updateProduct(userScopedClient, {
      p_product_id: productId,
      p_gallery: [{ mediaAssetId: assetB, isPrimary: true }],
      p_expected_updated_at: staleVersion,
    });
    assert.notEqual(winner.product.updated_at, staleVersion);

    const { data: loser, error: loserError } = await updateProduct(userScopedClient, {
      p_product_id: productId,
      p_gallery: [{ mediaAssetId: assetA, isPrimary: true }],
      p_expected_updated_at: staleVersion,
    });
    assert.equal(loser, null);
    assert.equal(loserError?.code, 'ADM09');

    const rows = await galleryRows(productId);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].media_asset_id, assetB, 'the rejected stale request must not have touched the gallery');
  } finally {
    if (productId) await serviceClient.from('products').delete().eq('id', productId);
    await serviceClient.auth.admin.deleteUser(userId);
  }
});

test('audit: gallery_updated fires exactly once when the gallery changes, and not at all when resaved unchanged', async () => {
  const { userId, userScopedClient } = await createAdminUserClient();
  let productId: string | null = null;
  try {
    const assetId = await mockFinalizedAsset(userScopedClient);
    const { data: created } = await createProduct(userScopedClient, { p_gallery: [{ mediaAssetId: assetId, isPrimary: true }] });
    productId = created.product.id;
    assert.equal(await auditCount(userScopedClient, productId, 'product.gallery_updated'), 1, 'creating with an image logs one gallery_updated event');

    const { data: resaved } = await updateProduct(userScopedClient, {
      p_product_id: productId,
      p_gallery: [{ mediaAssetId: assetId, isPrimary: true }],
      p_expected_updated_at: created.product.updated_at,
    });
    assert.equal(await auditCount(userScopedClient, productId, 'product.gallery_updated'), 1, 'resaving the identical gallery must not log a second event');
    assert.equal(resaved.gallery.length, 1);
  } finally {
    if (productId) await serviceClient.from('products').delete().eq('id', productId);
    await serviceClient.auth.admin.deleteUser(userId);
  }
});

test('a non-admin cannot save a gallery', async () => {
  const suffix = randomUUID();
  const email = `gallery-nonadmin-${suffix}@example.test`;
  const password = `Pw-${suffix}`;
  const { data: created } = await serviceClient.auth.admin.createUser({ email, password, email_confirm: true });
  const userId = created.user?.id as string;

  try {
    const anonAuthClient = createClient(supabaseUrl, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: session } = await anonAuthClient.auth.signInWithPassword({ email, password });
    const nonAdminClient = createClient(supabaseUrl, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${session.session?.access_token}` } },
    });

    const { data, error } = await createProduct(nonAdminClient);
    assert.equal(data, null);
    assert.equal(error?.code, 'ADM03');
  } finally {
    await serviceClient.auth.admin.deleteUser(userId);
  }
});
