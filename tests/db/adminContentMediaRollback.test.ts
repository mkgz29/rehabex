import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.ATOMIC_TEST_SUPABASE_URL ?? process.env.SUPABASE_URL ?? process.env.API_URL ?? '';
const serviceRoleKey = process.env.ATOMIC_TEST_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SERVICE_ROLE_KEY ?? '';
const anonKey = process.env.ATOMIC_TEST_ANON_KEY ?? process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY ?? '';
const dbContainer = process.env.ADMIN_02E_ROLLBACK_DB_CONTAINER ?? '';
const host = (() => {
  try {
    return new URL(supabaseUrl).hostname;
  } catch {
    return '';
  }
})();

if (
  !['127.0.0.1', 'localhost'].includes(host)
  || !serviceRoleKey
  || !anonKey
  || !/^supabase_db_[A-Za-z0-9_-]+$/.test(dbContainer)
) {
  throw new Error('ADMIN-02E rollback test requires explicit local Supabase credentials and a local DB container.');
}

const serviceClient = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const migration02bPath = path.join(process.cwd(), 'supabase/migrations/202609240101_admin_02b_atomic_product_visibility.sql');
const migration02cPath = path.join(process.cwd(), 'supabase/migrations/202609250101_admin_02c_product_gallery.sql');
const migration02ePath = path.join(process.cwd(), 'supabase/migrations/202609260101_admin_02e_content_media.sql');
const rollback02ePath = path.join(process.cwd(), 'supabase/rollbacks/202609260101_admin_02e_content_media.rollback.sql');

function runSql(sql: string, tuplesOnly = false) {
  const args = ['exec', '-i', dbContainer, 'psql', '-X', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', 'postgres'];
  if (tuplesOnly) args.push('-A', '-t');
  const result = spawnSync('docker', args, { input: sql, encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });
  assert.equal(
    result.status,
    0,
    `psql failed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
  );
  return result.stdout.trim();
}

function runSqlFile(filePath: string) {
  runSql(readFileSync(filePath, 'utf8'));
}

function scalar(sql: string) {
  return runSql(sql, true);
}

async function reloadPostgrest() {
  runSql("NOTIFY pgrst, 'reload schema';");
  await new Promise((resolve) => setTimeout(resolve, 750));
}

async function createAdmin() {
  const suffix = randomUUID();
  const email = `admin-02e-rollback-${suffix}@example.test`;
  const password = `Pw-${suffix}`;
  const { data: created, error: createError } = await serviceClient.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  assert.equal(createError, null);
  const userId = created.user?.id;
  assert.ok(userId);

  const { error: roleError } = await serviceClient.from('profiles').update({ role: 'admin' }).eq('id', userId);
  assert.equal(roleError, null);

  const authClient = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: session, error: signInError } = await authClient.auth.signInWithPassword({ email, password });
  assert.equal(signInError, null);
  const token = session.session?.access_token;
  assert.ok(token);

  return {
    userId,
    client: createClient(supabaseUrl, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${token}` } },
    }),
  };
}

async function finalizeAsset(client: ReturnType<typeof createClient>) {
  const publicId = `qa/admin-02e-rollback-${randomUUID()}`;
  const secureUrl = `https://res.cloudinary.com/demo/image/upload/${publicId}.jpg`;
  const requestId = randomUUID();
  const { error: pendingError } = await client.rpc('admin_create_pending_media_asset', {
    p_public_id: publicId,
    p_folder: 'rehabex/products',
    p_request_id: requestId,
  });
  assert.equal(pendingError, null);
  const { data, error } = await client.rpc('admin_finalize_media_asset', {
    p_public_id: publicId,
    p_secure_url: secureUrl,
    p_format: 'jpg',
    p_mime_type: 'image/jpeg',
    p_bytes: 100_000,
    p_width: 1000,
    p_height: 800,
    p_request_id: randomUUID(),
  });
  assert.equal(error, null);
  return { id: data.id as string, secureUrl };
}

function relevantRlsState() {
  return scalar(`
    SELECT jsonb_object_agg(relname, jsonb_build_object('rls', relrowsecurity, 'force', relforcerowsecurity) ORDER BY relname)::text
    FROM pg_class
    WHERE relnamespace = 'public'::regnamespace
      AND relname IN ('products', 'product_images', 'media_assets', 'settings', 'admin_audit_events');
  `);
}

function assertFinalFunctionCatalog() {
  const catalog = JSON.parse(scalar(`
    SELECT jsonb_object_agg(proname, jsonb_build_object(
      'count', function_count,
      'args', identity_args,
      'security_definer', security_definer,
      'config', config
    ))::text
    FROM (
      SELECT proname,
             count(*)::integer AS function_count,
             min(oidvectortypes(p.proargtypes)) AS identity_args,
             bool_and(prosecdef) AS security_definer,
             min(array_to_string(proconfig, ',')) AS config
      FROM pg_proc p
      WHERE pronamespace = 'public'::regnamespace
        AND proname IN ('admin_create_product_with_media', 'admin_update_product_with_media', 'admin_sync_product_gallery')
      GROUP BY proname
    ) functions;
  `)) as Record<string, { count: number; args: string; security_definer: boolean; config: string }>;

  assert.deepEqual(catalog.admin_create_product_with_media, {
    count: 1,
    args: 'text, text, text, numeric, boolean, integer, boolean, jsonb, uuid',
    security_definer: true,
    config: 'search_path=""',
  });
  assert.deepEqual(catalog.admin_update_product_with_media, {
    count: 1,
    args: 'uuid, text, text, text, numeric, boolean, integer, boolean, jsonb, timestamp with time zone, uuid',
    security_definer: true,
    config: 'search_path=""',
  });
  assert.deepEqual(catalog.admin_sync_product_gallery, {
    count: 1,
    args: 'uuid, jsonb, uuid',
    security_definer: true,
    config: 'search_path=""',
  });

  const privileges = JSON.parse(scalar(`
    SELECT jsonb_build_object(
      'create_anon', has_function_privilege('anon', 'public.admin_create_product_with_media(text,text,text,numeric,boolean,integer,boolean,jsonb,uuid)', 'EXECUTE'),
      'create_authenticated', has_function_privilege('authenticated', 'public.admin_create_product_with_media(text,text,text,numeric,boolean,integer,boolean,jsonb,uuid)', 'EXECUTE'),
      'update_anon', has_function_privilege('anon', 'public.admin_update_product_with_media(uuid,text,text,text,numeric,boolean,integer,boolean,jsonb,timestamptz,uuid)', 'EXECUTE'),
      'update_authenticated', has_function_privilege('authenticated', 'public.admin_update_product_with_media(uuid,text,text,text,numeric,boolean,integer,boolean,jsonb,timestamptz,uuid)', 'EXECUTE'),
      'sync_anon', has_function_privilege('anon', 'public.admin_sync_product_gallery(uuid,jsonb,uuid)', 'EXECUTE'),
      'sync_authenticated', has_function_privilege('authenticated', 'public.admin_sync_product_gallery(uuid,jsonb,uuid)', 'EXECUTE')
    )::text;
  `)) as Record<string, boolean>;
  assert.deepEqual(privileges, {
    create_anon: false,
    create_authenticated: true,
    update_anon: false,
    update_authenticated: true,
    sync_anon: false,
    sync_authenticated: false,
  });
  assert.equal(
    scalar(`
      SELECT count(*)
      FROM pg_proc p
      CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) acl
      WHERE p.pronamespace = 'public'::regnamespace
        AND p.proname IN ('admin_create_product_with_media', 'admin_update_product_with_media', 'admin_sync_product_gallery')
        AND acl.grantee = 0
        AND acl.privilege_type = 'EXECUTE';
    `),
    '0',
    'PUBLIC must not inherit EXECUTE through the default function ACL',
  );
}

test('ADMIN-02E rollback independently restores a working ADMIN-02C state and is repeatable', { timeout: 120_000 }, async () => {
  let userId: string | null = null;
  const productIds = new Set<string>();
  let galleryProductId = '';
  let legacyProductId = '';
  let assetId = '';
  let assetUrl = '';
  const legacyUrl = `https://res.cloudinary.com/demo/image/upload/qa/legacy-${randomUUID()}.jpg`;
  let client: ReturnType<typeof createClient> | null = null;

  try {
    assert.equal(scalar("SELECT to_regprocedure('public.admin_set_featured_products(jsonb,uuid)') IS NULL;"), 't');
    assert.equal(
      scalar("SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='product_images' AND column_name='media_asset_id';"),
      '0',
      'the isolated database must start at ADMIN-01C',
    );

    runSqlFile(migration02bPath);
    await reloadPostgrest();
    ({ userId, client } = await createAdmin());

    const { data: legacyCreated, error: legacyError } = await client.rpc('admin_create_product_with_media', {
      p_name: 'ADMIN-02E rollback legacy fixture',
      p_description: 'Contenido heredado',
      p_category: 'Ortopedia',
      p_price: 120,
      p_image_url: legacyUrl,
      p_image_asset_id: null,
      p_is_featured: false,
      p_display_order: 7,
      p_is_active: true,
      p_request_id: randomUUID(),
    });
    assert.equal(legacyError, null);
    legacyProductId = legacyCreated.id;
    productIds.add(legacyProductId);

    runSqlFile(migration02cPath);
    await reloadPostgrest();
    assert.equal(
      scalar(`SELECT count(*) FROM public.product_images WHERE product_id='${legacyProductId}'::uuid AND media_asset_id IS NULL AND url='${legacyUrl}';`),
      '1',
      'ADMIN-02C must backfill the legacy primary image',
    );

    ({ id: assetId, secureUrl: assetUrl } = await finalizeAsset(client));
    const { data: galleryCreated, error: galleryError } = await client.rpc('admin_create_product_with_media', {
      p_name: 'ADMIN-02E rollback gallery fixture',
      p_description: 'Contenido con galeria',
      p_category: 'Ortopedia',
      p_price: 250,
      p_is_featured: false,
      p_display_order: 9,
      p_is_active: true,
      p_gallery: [{ mediaAssetId: assetId, isPrimary: true }],
      p_request_id: randomUUID(),
    });
    assert.equal(galleryError, null);
    galleryProductId = galleryCreated.product.id;
    productIds.add(galleryProductId);
    const rlsAt02c = relevantRlsState();

    runSqlFile(migration02ePath);
    await reloadPostgrest();
    const framing = { mode: 'fill', focalX: 0.2, focalY: 0.8, zoom: 1.7 };
    const { data: framed, error: framingError } = await client.rpc('admin_update_product_with_media', {
      p_product_id: galleryProductId,
      p_name: 'ADMIN-02E rollback gallery fixture',
      p_description: 'Contenido con galeria',
      p_category: 'Ortopedia',
      p_price: 250,
      p_is_featured: false,
      p_display_order: 9,
      p_is_active: true,
      p_gallery: [{ mediaAssetId: assetId, isPrimary: true, framing }],
      p_expected_updated_at: galleryCreated.product.updated_at,
      p_request_id: randomUUID(),
    });
    assert.equal(framingError, null);
    assert.deepEqual(framed.gallery[0].framing, framing);
    const { error: featuredError } = await client.rpc('admin_set_featured_products', {
      p_items: [{ id: galleryProductId, isFeatured: true, displayOrder: 1 }],
      p_request_id: randomUUID(),
    });
    assert.equal(featuredError, null);
    const { error: settingError } = await client.rpc('admin_upsert_settings_document', {
      p_key: 'featured_section_content',
      p_value: { title: 'Rollback fixture', subtitle: 'Primera aplicacion' },
      p_expected_updated_at: null,
      p_request_id: randomUUID(),
    });
    assert.equal(settingError, null);

    const verifyRollback = async (cycle: number) => {
      assert.equal(
        scalar("SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='product_images' AND column_name='framing';"),
        '0',
      );
      assert.equal(scalar("SELECT to_regprocedure('public.admin_set_featured_products(jsonb,uuid)') IS NULL;"), 't');
      assert.equal(relevantRlsState(), rlsAt02c, 'RLS and FORCE RLS must return exactly to the ADMIN-02C state');
      assertFinalFunctionCatalog();

      const { error: exclusiveKeyError } = await client!.rpc('admin_upsert_settings_document', {
        p_key: 'featured_section_content',
        p_value: { title: 'No permitido', subtitle: '' },
        p_expected_updated_at: null,
        p_request_id: randomUUID(),
      });
      assert.equal(exclusiveKeyError?.code, 'ADM22');

      const { data: productRow, error: productError } = await serviceClient
        .from('products')
        .select('updated_at, image_url, image_asset_id, is_active, is_featured')
        .eq('id', galleryProductId)
        .single();
      assert.equal(productError, null);
      assert.equal(productRow.image_url, assetUrl);
      assert.equal(productRow.image_asset_id, assetId);
      assert.equal(productRow.is_active, true);
      assert.equal(productRow.is_featured, true, 'featured data remains in the pre-existing product columns');

      const { data: updated, error: updateError } = await client!.rpc('admin_update_product_with_media', {
        p_product_id: galleryProductId,
        p_name: `ADMIN-02E rollback gallery fixture cycle ${cycle}`,
        p_description: 'Contrato ADMIN-02C restaurado',
        p_category: 'Ortopedia',
        p_price: 250 + cycle,
        p_is_featured: true,
        p_display_order: 1,
        p_is_active: true,
        p_gallery: [{ mediaAssetId: assetId, isPrimary: true }],
        p_expected_updated_at: productRow.updated_at,
        p_request_id: randomUUID(),
      });
      assert.equal(updateError, null);
      assert.equal(updated.product.image_url, assetUrl);
      assert.equal(Object.hasOwn(updated.gallery[0], 'framing'), false);

      const { data: created, error: createError } = await client!.rpc('admin_create_product_with_media', {
        p_name: `ADMIN-02C create after isolated rollback ${cycle}`,
        p_description: '',
        p_category: 'Ortopedia',
        p_price: 50,
        p_is_featured: false,
        p_display_order: 50 + cycle,
        p_is_active: false,
        p_gallery: [],
        p_request_id: randomUUID(),
      });
      assert.equal(createError, null);
      productIds.add(created.product.id);

      const { data: legacyProduct, error: legacyProductError } = await serviceClient
        .from('products')
        .select('image_url, is_active')
        .eq('id', legacyProductId)
        .single();
      assert.equal(legacyProductError, null);
      assert.equal(legacyProduct.image_url, legacyUrl);
      assert.equal(legacyProduct.is_active, true);
      assert.equal(
        scalar(`SELECT count(*) FROM public.product_images WHERE product_id='${legacyProductId}'::uuid AND media_asset_id IS NULL AND url='${legacyUrl}';`),
        '1',
      );
    };

    runSqlFile(rollback02ePath);
    await reloadPostgrest();
    await verifyRollback(1);

    runSqlFile(migration02ePath);
    await reloadPostgrest();
    assert.equal(
      scalar("SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='product_images' AND column_name='framing';"),
      '1',
    );
    assert.equal(scalar("SELECT to_regprocedure('public.admin_set_featured_products(jsonb,uuid)') IS NOT NULL;"), 't');

    const { data: productBeforeReapplyUpdate } = await serviceClient
      .from('products')
      .select('updated_at')
      .eq('id', galleryProductId)
      .single();
    const reframing = { mode: 'contain', focalX: 0.5, focalY: 0.5, zoom: 1 };
    const { data: reappliedUpdate, error: reappliedUpdateError } = await client.rpc('admin_update_product_with_media', {
      p_product_id: galleryProductId,
      p_name: 'ADMIN-02E works after reapply',
      p_description: 'Segundo ciclo',
      p_category: 'Ortopedia',
      p_price: 275,
      p_is_featured: true,
      p_display_order: 1,
      p_is_active: true,
      p_gallery: [{ mediaAssetId: assetId, isPrimary: true, framing: reframing }],
      p_expected_updated_at: productBeforeReapplyUpdate?.updated_at,
      p_request_id: randomUUID(),
    });
    assert.equal(reappliedUpdateError, null);
    assert.deepEqual(reappliedUpdate.gallery[0].framing, reframing);
    const { error: reappliedFeaturedError } = await client.rpc('admin_set_featured_products', {
      p_items: [{ id: galleryProductId, isFeatured: true, displayOrder: 2 }],
      p_request_id: randomUUID(),
    });
    assert.equal(reappliedFeaturedError, null);
    const { data: settingVersion } = await serviceClient
      .from('settings')
      .select('updated_at')
      .eq('key', 'featured_section_content')
      .single();
    const { error: reappliedSettingError } = await client.rpc('admin_upsert_settings_document', {
      p_key: 'featured_section_content',
      p_value: { title: 'Rollback fixture', subtitle: 'Segunda aplicacion' },
      p_expected_updated_at: settingVersion?.updated_at,
      p_request_id: randomUUID(),
    });
    assert.equal(reappliedSettingError, null);

    runSqlFile(rollback02ePath);
    await reloadPostgrest();
    await verifyRollback(2);
  } finally {
    try {
      if (scalar("SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='product_images' AND column_name='framing';") !== '0') {
        runSqlFile(rollback02ePath);
      }
    } catch {
      // Preserve the original assertion failure; the isolated stack is also
      // destroyed by the caller after this test command finishes.
    }

    if (productIds.size > 0 || userId) {
      const ids = [...productIds].map((id) => `'${id}'::uuid`).join(', ');
      runSql(`
        DELETE FROM public.admin_audit_events WHERE actor_id = ${userId ? `'${userId}'::uuid` : 'NULL'};
        ${ids ? `DELETE FROM public.product_images WHERE product_id IN (${ids});` : ''}
        ${ids ? `DELETE FROM public.products WHERE id IN (${ids});` : ''}
        ${userId ? `DELETE FROM public.media_assets WHERE created_by = '${userId}'::uuid;` : ''}
        DELETE FROM public.settings WHERE key IN ('featured_section_content', 'catalog_section_content');
      `);
    }
    if (userId) await serviceClient.auth.admin.deleteUser(userId);
  }
});
