import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const migration02c = readFileSync(
  path.join(process.cwd(), 'supabase/migrations/202609250101_admin_02c_product_gallery.sql'),
  'utf8',
);
const rollback02e = readFileSync(
  path.join(process.cwd(), 'supabase/rollbacks/202609260101_admin_02e_content_media.rollback.sql'),
  'utf8',
);

const CREATE_PREFIX = 'CREATE FUNCTION "public".';
const CREATE_OR_REPLACE_PREFIX = 'CREATE OR REPLACE FUNCTION "public".';

function functionDefinition(sql: string, name: string) {
  const quotedName = `"${name}"`;
  const start = [
    sql.indexOf(`${CREATE_OR_REPLACE_PREFIX}${quotedName}`),
    sql.indexOf(`${CREATE_PREFIX}${quotedName}`),
  ].filter((index) => index >= 0).sort((a, b) => a - b)[0];
  assert.notEqual(start, undefined, `missing ${name}`);
  const end = sql.indexOf('\n$$;', start);
  assert.ok(end > start, `unterminated ${name}`);
  return sql.slice(start, end + '\n$$;'.length);
}

function canonicalSql(sql: string) {
  return sql
    .replace(/--.*$/gm, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const restoredNames = [
  'admin_sync_product_gallery',
  'admin_create_product_with_media',
  'admin_update_product_with_media',
] as const;

test('ADMIN-02E rollback restores the exact ADMIN-02C gallery function bodies', () => {
  for (const name of restoredNames) {
    const expected = canonicalSql(functionDefinition(migration02c, name));
    const actual = canonicalSql(functionDefinition(rollback02e, name));
    assert.equal(actual, expected, `${name} must be restored exactly from ADMIN-02C`);
    assert.doesNotMatch(actual, /\bframing\b/i, `${name} must not retain ADMIN-02E framing references`);
    assert.match(actual, /SECURITY DEFINER SET search_path = ''/);
  }
});

test('ADMIN-02E rollback removes dependent wrappers before dropping framing', () => {
  const dropCreate = rollback02e.indexOf('DROP FUNCTION IF EXISTS "public"."admin_create_product_with_media"');
  const dropUpdate = rollback02e.indexOf('DROP FUNCTION IF EXISTS "public"."admin_update_product_with_media"');
  const restoreHelper = rollback02e.indexOf('CREATE OR REPLACE FUNCTION "public"."admin_sync_product_gallery"');
  const restoreCreate = rollback02e.indexOf('CREATE FUNCTION "public"."admin_create_product_with_media"');
  const restoreUpdate = rollback02e.indexOf('CREATE FUNCTION "public"."admin_update_product_with_media"');
  const dropFraming = rollback02e.indexOf('ALTER TABLE "public"."product_images" DROP COLUMN IF EXISTS "framing"');
  const dropFeatured = rollback02e.indexOf('DROP FUNCTION IF EXISTS "public"."admin_set_featured_products"');
  const restoreSettings = rollback02e.indexOf('CREATE OR REPLACE FUNCTION "public"."admin_upsert_settings_document"');

  assert.ok(dropCreate >= 0 && dropUpdate >= 0);
  assert.ok(dropCreate < restoreHelper && dropUpdate < restoreHelper);
  assert.ok(restoreHelper < restoreCreate && restoreCreate < restoreUpdate);
  assert.ok(restoreUpdate < dropFraming, 'framing must be dropped only after every gallery RPC is restored');
  assert.ok(dropFraming < dropFeatured, 'the exclusive framing column is removed before the featured-products RPC');
  assert.ok(dropFeatured < restoreSettings, 'the previous document allowlist is restored last');
});

test('ADMIN-02E rollback restores the ADMIN-02C grants without exposing RPCs publicly', () => {
  assert.doesNotMatch(rollback02e, /^\s*GRANT\b.*\bTO\b.*(?:PUBLIC|"anon")/gim);

  for (const signature of [
    '"admin_create_product_with_media"(text, text, text, numeric, boolean, integer, boolean, jsonb, uuid)',
    '"admin_update_product_with_media"(uuid, text, text, text, numeric, boolean, integer, boolean, jsonb, timestamptz, uuid)',
  ]) {
    assert.ok(
      rollback02e.includes(`REVOKE ALL ON FUNCTION "public".${signature} FROM PUBLIC, "anon", "authenticated";`),
      `missing closed-default revoke for ${signature}`,
    );
    assert.ok(
      rollback02e.includes(`GRANT EXECUTE ON FUNCTION "public".${signature} TO "authenticated";`),
      `missing authenticated grant for ${signature}`,
    );
  }

  assert.ok(
    rollback02e.includes(
      'REVOKE ALL ON FUNCTION "public"."admin_sync_product_gallery"(uuid, jsonb, uuid) FROM PUBLIC, "anon", "authenticated";',
    ),
  );
  assert.doesNotMatch(rollback02e, /GRANT EXECUTE ON FUNCTION "public"\."admin_sync_product_gallery"/);
});

test('ADMIN-02E rollback restores the pre-02E editorial allowlist', () => {
  const settingsBody = functionDefinition(rollback02e, 'admin_upsert_settings_document');
  assert.match(settingsBody, /p_key NOT IN \('hero_content', 'about_content'\)/);
  assert.doesNotMatch(settingsBody, /featured_section_content|catalog_section_content/);
});
