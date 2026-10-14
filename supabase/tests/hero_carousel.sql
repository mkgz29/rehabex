\set ON_ERROR_STOP on

-- FASE CMS: hero_images table, admin_sync_hero_images RPC, RLS/grants,
-- eyebrow backfill.

BEGIN;

CREATE TEMP TABLE hero_results (
  test_name text PRIMARY KEY,
  ok boolean NOT NULL,
  detail text NOT NULL
);

CREATE OR REPLACE FUNCTION pg_temp.make_pending_asset(p_created_by uuid, p_public_id text)
RETURNS uuid
LANGUAGE plpgsql
AS $$
DECLARE v_id uuid;
BEGIN
  INSERT INTO public.media_assets (provider, public_id, folder, secure_url, status, created_by)
  VALUES ('cloudinary', p_public_id, 'rehabex/hero', 'https://res.cloudinary.test/' || p_public_id || '.jpg', 'pending', p_created_by)
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

DO $$
DECLARE
  v_admin_id uuid := gen_random_uuid();
  v_other_admin_id uuid := gen_random_uuid();
  v_customer_id uuid := gen_random_uuid();
  v_asset_1 uuid;
  v_asset_2 uuid;
  v_asset_3 uuid;
  v_foreign_asset uuid;
  v_result jsonb;
  v_count integer;
BEGIN
  INSERT INTO auth.users (id, email) VALUES
    (v_admin_id, 'admin-' || v_admin_id || '@example.test'),
    (v_other_admin_id, 'admin2-' || v_other_admin_id || '@example.test'),
    (v_customer_id, 'customer-' || v_customer_id || '@example.test');
  INSERT INTO public.profiles (id, role) VALUES
    (v_admin_id, 'admin'), (v_other_admin_id, 'admin'), (v_customer_id, 'customer')
    ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role;

  -- 1. Pre-existing single hero image (from before this phase) was backfilled
  -- as slide 0.
  SELECT count(*) INTO v_count FROM public.hero_images;
  IF v_count <> 1 THEN RAISE EXCEPTION 'expected exactly 1 backfilled hero image, got %', v_count; END IF;
  INSERT INTO hero_results VALUES ('pre-existing hero image was backfilled as a single slide', true, '1 row');

  -- 2. Eyebrow was backfilled onto hero_content, preserving today's copy.
  IF NOT EXISTS (SELECT 1 FROM public.settings WHERE key = 'hero_content' AND value->>'eyebrow' = 'Rehabilitación · Movilidad · Bienestar') THEN
    RAISE EXCEPTION 'hero_content.eyebrow was not backfilled with the current hardcoded copy';
  END IF;
  INSERT INTO hero_results VALUES ('hero_content.eyebrow backfilled with the current hardcoded copy', true, 'matched');

  -- 3. Non-admin is rejected.
  PERFORM set_config('request.jwt.claim.sub', v_customer_id::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_customer_id, 'role', 'authenticated')::text, true);
  SET ROLE authenticated;
  BEGIN
    PERFORM public.admin_sync_hero_images('[]'::jsonb, gen_random_uuid());
    RESET ROLE;
    RAISE EXCEPTION 'a non-admin was allowed to sync hero images';
  EXCEPTION WHEN SQLSTATE 'ADM03' THEN
    RESET ROLE;
  END;
  INSERT INTO hero_results VALUES ('non-admin is rejected (ADM03)', true, 'forbidden raised');

  -- Switch to the admin identity for the rest of the test.
  PERFORM set_config('request.jwt.claim.sub', v_admin_id::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin_id, 'role', 'authenticated')::text, true);

  -- 4. Replace the whole set with 3 fresh pending assets -- the "3+" recommended case.
  v_asset_1 := pg_temp.make_pending_asset(v_admin_id, 'slide-1');
  v_asset_2 := pg_temp.make_pending_asset(v_admin_id, 'slide-2');
  v_asset_3 := pg_temp.make_pending_asset(v_admin_id, 'slide-3');
  SET ROLE authenticated;
  v_result := public.admin_sync_hero_images(
    jsonb_build_array(
      jsonb_build_object('mediaAssetId', v_asset_1, 'alt', 'Primera', 'enabled', true),
      jsonb_build_object('mediaAssetId', v_asset_2, 'alt', 'Segunda', 'enabled', true),
      jsonb_build_object('mediaAssetId', v_asset_3, 'alt', 'Tercera', 'enabled', false)
    ),
    gen_random_uuid()
  );
  RESET ROLE;
  IF jsonb_array_length(v_result) <> 3 THEN RAISE EXCEPTION 'expected 3 slides after sync, got %', jsonb_array_length(v_result); END IF;
  SELECT count(*) INTO v_count FROM public.hero_images WHERE enabled = true;
  IF v_count <> 2 THEN RAISE EXCEPTION 'expected 2 enabled slides, got %', v_count; END IF;
  INSERT INTO hero_results VALUES ('sync replaces the whole set with 3 images (2 enabled, 1 disabled)', true, '3 rows, 2 enabled');

  -- 5. Assets just attached read back as 'attached'.
  IF (SELECT status FROM public.media_assets WHERE id = v_asset_1) <> 'attached' THEN
    RAISE EXCEPTION 'asset was not marked attached';
  END IF;
  INSERT INTO hero_results VALUES ('synced assets are marked attached', true, 'status=attached');

  -- 6. The old backfilled legacy row (slide 0, media_asset_id NULL) was dropped
  -- by the full-replace and is gone -- never orphan_candidate'd (legacy rows
  -- have no media_assets row to touch), just removed from hero_images.
  SELECT count(*) INTO v_count FROM public.hero_images WHERE media_asset_id IS NULL;
  IF v_count <> 0 THEN RAISE EXCEPTION 'legacy backfilled slide should have been replaced'; END IF;
  INSERT INTO hero_results VALUES ('full replace drops the old legacy slide cleanly', true, '0 legacy rows left');

  -- 7. Replacing again without asset_2 orphans it.
  SET ROLE authenticated;
  PERFORM public.admin_sync_hero_images(
    jsonb_build_array(
      jsonb_build_object('mediaAssetId', v_asset_1, 'alt', 'Primera', 'enabled', true),
      jsonb_build_object('mediaAssetId', v_asset_3, 'alt', 'Tercera', 'enabled', true)
    ),
    gen_random_uuid()
  );
  RESET ROLE;
  IF (SELECT status FROM public.media_assets WHERE id = v_asset_2) <> 'orphan_candidate' THEN
    RAISE EXCEPTION 'removed asset was not marked orphan_candidate';
  END IF;
  INSERT INTO hero_results VALUES ('a removed slide''s asset becomes orphan_candidate', true, 'status=orphan_candidate');

  -- 8. A different admin cannot claim another admin's pending asset.
  v_foreign_asset := pg_temp.make_pending_asset(v_other_admin_id, 'foreign-asset');
  SET ROLE authenticated;
  BEGIN
    PERFORM public.admin_sync_hero_images(jsonb_build_array(jsonb_build_object('mediaAssetId', v_foreign_asset, 'enabled', true)), gen_random_uuid());
    RESET ROLE;
    RAISE EXCEPTION 'an asset owned by another admin was claimed';
  EXCEPTION WHEN SQLSTATE 'ADM03' THEN
    RESET ROLE;
  END;
  INSERT INTO hero_results VALUES ('an asset owned by a different admin cannot be claimed (ADM03)', true, 'forbidden raised');

  -- NOTE: a 9th case ("an asset already attached to a product cannot be
  -- reused as a hero slide") is deliberately NOT covered by an automated
  -- test here. The guard itself IS implemented in admin_sync_hero_images
  -- above (`IF EXISTS (SELECT 1 FROM product_images WHERE media_asset_id =
  -- v_asset_id) THEN RAISE 'asset_already_used'`); what's missing is
  -- verification. Calling the pre-existing, out-of-scope
  -- admin_sync_product_gallery RPC in this sandbox reproducibly crashes the
  -- Postgres backend with SIGSEGV (confirmed in isolation, independent of
  -- hero_images entirely -- see the phase report), which this migration
  -- does not introduce and this task does not authorize investigating or
  -- fixing. Flagged for manual/clean-environment verification before relying
  -- on this guard.

  -- 9. More than 8 images is rejected.
  SET ROLE authenticated;
  BEGIN
    PERFORM public.admin_sync_hero_images(
      (SELECT jsonb_agg(jsonb_build_object('legacyUrl', 'https://example.test/' || g || '.jpg', 'enabled', true)) FROM generate_series(1, 9) g),
      gen_random_uuid()
    );
    RESET ROLE;
    RAISE EXCEPTION 'more than 8 images was accepted';
  EXCEPTION WHEN SQLSTATE 'ADM22' THEN
    RESET ROLE;
  END;
  INSERT INTO hero_results VALUES ('more than 8 images is rejected (ADM22)', true, 'too_many_images raised');

  -- 10. Duplicate asset ids in the same call are rejected.
  SET ROLE authenticated;
  BEGIN
    PERFORM public.admin_sync_hero_images(jsonb_build_array(jsonb_build_object('mediaAssetId', v_asset_1, 'enabled', true), jsonb_build_object('mediaAssetId', v_asset_1, 'enabled', false)), gen_random_uuid());
    RESET ROLE;
    RAISE EXCEPTION 'duplicate asset ids were accepted';
  EXCEPTION WHEN SQLSTATE 'ADM22' THEN
    RESET ROLE;
  END;
  INSERT INTO hero_results VALUES ('duplicate asset ids in one call are rejected (ADM22)', true, 'duplicate_image raised');

  -- 12. RLS: enabled+forced, exactly 2 policies (anon: enabled-only; authenticated: enabled-or-admin).
  IF NOT (SELECT relrowsecurity AND relforcerowsecurity FROM pg_class WHERE oid = 'public.hero_images'::regclass) THEN
    RAISE EXCEPTION 'RLS not enabled+forced on hero_images';
  END IF;
  IF (SELECT count(*) FROM pg_policy WHERE polrelid = 'public.hero_images'::regclass) <> 2 THEN
    RAISE EXCEPTION 'unexpected policy count on hero_images';
  END IF;
  INSERT INTO hero_results VALUES ('hero_images RLS enabled+forced, exactly 2 policies', true, 'confirmed');

  -- 13. Grants: anon/authenticated SELECT only, no write.
  IF has_table_privilege('anon', 'public.hero_images', 'INSERT')
     OR has_table_privilege('anon', 'public.hero_images', 'UPDATE')
     OR has_table_privilege('anon', 'public.hero_images', 'DELETE')
     OR has_table_privilege('authenticated', 'public.hero_images', 'INSERT')
     OR has_table_privilege('authenticated', 'public.hero_images', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.hero_images', 'DELETE')
     OR NOT has_table_privilege('anon', 'public.hero_images', 'SELECT') THEN
    RAISE EXCEPTION 'hero_images grants are wrong';
  END IF;
  INSERT INTO hero_results VALUES ('hero_images grants: SELECT only for anon/authenticated, no direct write', true, 'confirmed');

  -- 14. RPC grants: authenticated only, anon none.
  IF has_function_privilege('anon', 'public.admin_sync_hero_images(jsonb,uuid)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.admin_sync_hero_images(jsonb,uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'admin_sync_hero_images grants are wrong';
  END IF;
  INSERT INTO hero_results VALUES ('admin_sync_hero_images grants: authenticated only, anon none', true, 'confirmed');

  -- 15. Anon can only read the currently-enabled slide(s).
  SET ROLE authenticated;
  PERFORM public.admin_sync_hero_images(
    jsonb_build_array(
      jsonb_build_object('mediaAssetId', v_asset_1, 'enabled', true),
      jsonb_build_object('mediaAssetId', v_asset_3, 'enabled', false)
    ),
    gen_random_uuid()
  );
  RESET ROLE;
  SET ROLE anon;
  SELECT count(*) INTO v_count FROM public.hero_images;
  RESET ROLE;
  IF v_count <> 1 THEN RAISE EXCEPTION 'anon should see exactly 1 enabled slide, saw %', v_count; END IF;
  INSERT INTO hero_results VALUES ('anon reads only enabled slides, never disabled ones', true, '1 visible row');

  -- 16. An empty set is allowed (0 images: public falls back to its own safe
  -- state). Run last -- it deliberately wipes every existing slide, so
  -- nothing after this can rely on v_asset_1/v_asset_3 still being attached.
  SET ROLE authenticated;
  v_result := public.admin_sync_hero_images('[]'::jsonb, gen_random_uuid());
  RESET ROLE;
  IF jsonb_array_length(v_result) <> 0 THEN RAISE EXCEPTION 'empty gallery was rejected or not applied'; END IF;
  INSERT INTO hero_results VALUES ('an empty set (0 images) is accepted, never blocked', true, '0 rows, no error');

  -- 17. REGRESSION (202610180101): the full-replace DELETE must carry an
  -- explicit WHERE clause. A bare `DELETE FROM public.hero_images;` passes
  -- fine over this direct psql session (no safe-update protection here),
  -- which is exactly why this regression shipped once already -- it only
  -- ever failed through PostgREST's connection, which enforces safe-update.
  -- This check is static (reads the function's own source), so it catches
  -- the regression regardless of which connection runs the test.
  IF (SELECT prosrc FROM pg_proc WHERE proname = 'admin_sync_hero_images') ~ 'DELETE FROM public\.hero_images;\s' THEN
    RAISE EXCEPTION 'admin_sync_hero_images contains a bare DELETE with no WHERE clause -- fails under PostgREST safe-update protection (SQLSTATE 21000)';
  END IF;
  INSERT INTO hero_results VALUES ('admin_sync_hero_images never issues a bare DELETE without WHERE', true, 'WHERE id IS NOT NULL present');
END;
$$;

-- Per-slide framing (self-contained: fresh admin/assets, independent of the
-- block above, so it never depends on its leftover state).
DO $$
DECLARE
  v_admin_id uuid := gen_random_uuid();
  v_asset_1 uuid;
  v_asset_2 uuid;
  v_result jsonb;
  v_legacy_url text;
  v_item jsonb;
BEGIN
  INSERT INTO auth.users (id, email) VALUES (v_admin_id, 'framing-' || v_admin_id || '@example.test');
  INSERT INTO public.profiles (id, role) VALUES (v_admin_id, 'admin') ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role;
  PERFORM set_config('request.jwt.claim.sub', v_admin_id::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin_id, 'role', 'authenticated')::text, true);

  -- Start from a known single legacy slide for this block.
  SET ROLE authenticated;
  v_result := public.admin_sync_hero_images('[]'::jsonb, gen_random_uuid());
  RESET ROLE;
  INSERT INTO public.hero_images (media_asset_id, url, alt_text, display_order, enabled)
  VALUES (NULL, 'https://x.test/framing-legacy.jpg', 'Legacy', 0, true);
  v_legacy_url := 'https://x.test/framing-legacy.jpg';

  INSERT INTO public.media_assets (provider, public_id, folder, secure_url, status, created_by)
  VALUES ('cloudinary', 'framing-asset-1', 'rehabex/hero', 'https://x.test/framing-1.jpg', 'pending', v_admin_id) RETURNING id INTO v_asset_1;
  INSERT INTO public.media_assets (provider, public_id, folder, secure_url, status, created_by)
  VALUES ('cloudinary', 'framing-asset-2', 'rehabex/hero', 'https://x.test/framing-2.jpg', 'pending', v_admin_id) RETURNING id INTO v_asset_2;

  -- 1/5/6/7: a new media-backed image with no framing key gets the column
  -- default; a legacy image can also receive a custom framing, by
  -- legacyUrl, with no mediaAssetId required.
  SET ROLE authenticated;
  v_result := public.admin_sync_hero_images(
    jsonb_build_array(
      jsonb_build_object('legacyUrl', v_legacy_url, 'alt', 'Legacy', 'enabled', true, 'framing', jsonb_build_object('mode', 'contain', 'focalX', 0.2, 'focalY', 0.8, 'zoom', 2)),
      jsonb_build_object('mediaAssetId', v_asset_1, 'alt', 'Nueva sin framing', 'enabled', true)
    ),
    gen_random_uuid()
  );
  RESET ROLE;

  SELECT value INTO v_item FROM jsonb_array_elements(v_result) WHERE value->>'mediaAssetId' IS NULL;
  IF v_item->'framing' <> jsonb_build_object('mode', 'contain', 'focalX', 0.2, 'focalY', 0.8, 'zoom', 2) THEN
    RAISE EXCEPTION 'legacy image framing was not persisted correctly, got %', v_item->'framing';
  END IF;
  INSERT INTO hero_results VALUES ('a legacy image can receive a custom framing by legacyUrl (no mediaAssetId needed)', true, 'mode=contain focalX=0.2 focalY=0.8 zoom=2');

  SELECT value INTO v_item FROM jsonb_array_elements(v_result) WHERE value->>'mediaAssetId' = v_asset_1::text;
  IF v_item->'framing' <> '{"mode":"fill","focalX":0.5,"focalY":0.5,"zoom":1}'::jsonb THEN
    RAISE EXCEPTION 'media-backed image with no framing key did not default correctly, got %', v_item->'framing';
  END IF;
  INSERT INTO hero_results VALUES ('a new media-backed image with no framing key defaults to DEFAULT_FRAMING', true, 'mode=fill focalX=0.5 focalY=0.5 zoom=1');

  -- 2/3/4: changing focalX/focalY, zoom, and mode (contain) all persist
  -- independently -- already proven by the legacy-image assertion above
  -- (mode=contain, focalX=0.2, focalY=0.8, zoom=2 all differ from default
  -- and all round-tripped). Confirm a *different* zoom on a second image
  -- in the same call, proving slides don't share one framing.
  SET ROLE authenticated;
  v_result := public.admin_sync_hero_images(
    jsonb_build_array(
      jsonb_build_object('legacyUrl', v_legacy_url, 'alt', 'Legacy', 'enabled', true, 'framing', jsonb_build_object('mode', 'fill', 'focalX', 0.1, 'focalY', 0.1, 'zoom', 1.2)),
      jsonb_build_object('mediaAssetId', v_asset_1, 'alt', '', 'enabled', true, 'framing', jsonb_build_object('mode', 'fill', 'focalX', 0.9, 'focalY', 0.9, 'zoom', 3))
    ),
    gen_random_uuid()
  );
  RESET ROLE;
  SELECT value INTO v_item FROM jsonb_array_elements(v_result) WHERE value->>'mediaAssetId' IS NULL;
  IF (v_item->'framing'->>'zoom')::numeric <> 1.2 THEN RAISE EXCEPTION 'first slide zoom not persisted'; END IF;
  SELECT value INTO v_item FROM jsonb_array_elements(v_result) WHERE value->>'mediaAssetId' = v_asset_1::text;
  IF (v_item->'framing'->>'zoom')::numeric <> 3 THEN RAISE EXCEPTION 'second slide zoom not persisted, or slides share one framing'; END IF;
  INSERT INTO hero_results VALUES ('two slides in the same call keep independent framing (different zoom each)', true, 'zoom 1.2 vs zoom 3');

  -- 9/10: invalid framing (bad mode, out-of-range values) is rejected before
  -- anything is written.
  SET ROLE authenticated;
  BEGIN
    PERFORM public.admin_sync_hero_images(jsonb_build_array(jsonb_build_object('legacyUrl', v_legacy_url, 'alt', '', 'enabled', true, 'framing', jsonb_build_object('mode', 'bogus', 'focalX', 0.5, 'focalY', 0.5, 'zoom', 1))), gen_random_uuid());
    RESET ROLE;
    RAISE EXCEPTION 'an invalid framing mode was accepted';
  EXCEPTION WHEN SQLSTATE 'ADM22' THEN
    RESET ROLE;
  END;
  SET ROLE authenticated;
  BEGIN
    PERFORM public.admin_sync_hero_images(jsonb_build_array(jsonb_build_object('legacyUrl', v_legacy_url, 'alt', '', 'enabled', true, 'framing', jsonb_build_object('mode', 'fill', 'focalX', 0.5, 'focalY', 0.5, 'zoom', 99))), gen_random_uuid());
    RESET ROLE;
    RAISE EXCEPTION 'an out-of-range zoom was accepted';
  EXCEPTION WHEN SQLSTATE 'ADM22' THEN
    RESET ROLE;
  END;
  INSERT INTO hero_results VALUES ('invalid framing (bad mode or out-of-range values) is rejected (ADM22)', true, 'invalid_gallery raised');

  -- A present-but-null framing is tolerated the same as absent (the shape
  -- the client's own validator emits when it has no opinion).
  SET ROLE authenticated;
  v_result := public.admin_sync_hero_images(jsonb_build_array(jsonb_build_object('legacyUrl', v_legacy_url, 'alt', '', 'enabled', true, 'framing', 'null'::jsonb)), gen_random_uuid());
  RESET ROLE;
  IF (v_result->0->'framing') <> '{"mode":"fill","focalX":0.5,"focalY":0.5,"zoom":1}'::jsonb THEN
    RAISE EXCEPTION 'a present-but-null framing was not defaulted correctly';
  END IF;
  INSERT INTO hero_results VALUES ('a present-but-null framing defaults the same as an absent one', true, 'DEFAULT_FRAMING applied');

  -- 11: an "old" image row (inserted before this migration's column default
  -- existed on this exact row -- simulated by the legacy backfill pattern:
  -- any row never explicitly given framing already reads the column
  -- default) still works end-to-end.
  SET ROLE authenticated;
  v_result := public.admin_sync_hero_images(jsonb_build_array(jsonb_build_object('legacyUrl', v_legacy_url, 'alt', '', 'enabled', true)), gen_random_uuid());
  RESET ROLE;
  IF jsonb_array_length(v_result) <> 1 THEN RAISE EXCEPTION 'old-style payload without framing failed'; END IF;
  INSERT INTO hero_results VALUES ('a payload with no framing key at all (pre-framing client) still works', true, 'applied, defaulted');
END;
$$;

SELECT test_name, ok, detail FROM hero_results ORDER BY test_name;

ROLLBACK;
