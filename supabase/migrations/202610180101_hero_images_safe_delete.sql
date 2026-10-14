BEGIN;

-- Fixes a real production bug in admin_sync_hero_images (202610170101):
-- every single real save of the Hero carousel failed with a 500 whose real
-- Postgres error (surfaced only after 202610180101's logging phase) was:
--
--   dbCode: 21000
--   dbMessage: DELETE requires a WHERE clause
--
-- The connection PostgREST uses enforces "safe update" mode (no bare
-- DELETE/UPDATE without a WHERE), which a direct psql session (used to
-- verify this RPC locally and in the sandbox -- see the phase's own test
-- history) does not enforce. That is exactly why the RPC worked by raw SQL
-- but failed every time through the real app: the only thing different
-- between those two paths is this safe-update protection on the PostgREST
-- connection.
--
-- Fix: the bare `DELETE FROM public.hero_images;` becomes
-- `DELETE FROM public.hero_images WHERE id IS NOT NULL;` -- id is the
-- primary key (NOT NULL), so this is semantically still "delete every row",
-- just with an explicit WHERE clause that satisfies the protection.
--
-- Nothing else about the function changes: same signature, same
-- SECURITY DEFINER/search_path/owner/grants, same validation passes, same
-- media asset claim/orphan lifecycle, same audit insert. This is a one-line
-- fix inside an otherwise byte-identical CREATE OR REPLACE FUNCTION.

CREATE OR REPLACE FUNCTION "public"."admin_sync_hero_images"(
  "p_images" jsonb,
  "p_request_id" uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_count integer;
  v_item jsonb;
  v_asset_id uuid;
  v_legacy_url text;
  v_is_legacy boolean;
  v_alt text;
  v_enabled boolean;
  v_order integer;
  v_seen_ids uuid[] := ARRAY[]::uuid[];
  v_seen_urls text[] := ARRAY[]::text[];
  v_asset public.media_assets;
  v_secure_url text;
  v_old_ids uuid[];
  v_removed_id uuid;
  v_before jsonb;
  v_after jsonb;
  v_result jsonb;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE = 'ADM01'; END IF;
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = 'ADM03'; END IF;
  IF p_request_id IS NULL OR jsonb_typeof(p_images) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'invalid_gallery' USING ERRCODE = 'ADM22';
  END IF;

  v_count := jsonb_array_length(p_images);
  IF v_count > 8 THEN RAISE EXCEPTION 'too_many_images' USING ERRCODE = 'ADM22'; END IF;

  SELECT jsonb_agg(jsonb_build_object('mediaAssetId', media_asset_id, 'enabled', enabled) ORDER BY display_order)
    INTO v_before
  FROM public.hero_images;
  v_before := COALESCE(v_before, '[]'::jsonb);

  SELECT array_agg(media_asset_id) INTO v_old_ids FROM public.hero_images;

  -- Pass 1: validate every entry before writing anything (same two-pass
  -- shape as admin_sync_product_gallery, for the same reason: never leave
  -- hero_images partially replaced if a later entry turns out invalid).
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_images)
  LOOP
    IF jsonb_typeof(v_item) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'invalid_gallery' USING ERRCODE = 'ADM22'; END IF;

    v_asset_id := NULLIF(v_item->>'mediaAssetId', '')::uuid;
    v_legacy_url := NULLIF(v_item->>'legacyUrl', '');
    v_is_legacy := v_legacy_url IS NOT NULL;
    IF (v_asset_id IS NULL) = (v_legacy_url IS NULL) THEN
      RAISE EXCEPTION 'invalid_gallery' USING ERRCODE = 'ADM22';
    END IF;

    IF jsonb_typeof(v_item->'enabled') IS DISTINCT FROM 'boolean' THEN
      RAISE EXCEPTION 'invalid_gallery' USING ERRCODE = 'ADM22';
    END IF;

    IF v_is_legacy THEN
      IF v_legacy_url = ANY(v_seen_urls) THEN RAISE EXCEPTION 'duplicate_image' USING ERRCODE = 'ADM22'; END IF;
      v_seen_urls := array_append(v_seen_urls, v_legacy_url);

      IF NOT EXISTS (
        SELECT 1 FROM public.hero_images
        WHERE media_asset_id IS NULL AND url = v_legacy_url
      ) THEN
        RAISE EXCEPTION 'invalid_gallery' USING ERRCODE = 'ADM22';
      END IF;
    ELSE
      IF v_asset_id = ANY(v_seen_ids) THEN RAISE EXCEPTION 'duplicate_image' USING ERRCODE = 'ADM22'; END IF;
      v_seen_ids := array_append(v_seen_ids, v_asset_id);

      SELECT * INTO v_asset FROM public.media_assets WHERE id = v_asset_id FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION 'asset_not_found' USING ERRCODE = 'ADM04'; END IF;
      IF v_asset.created_by <> v_actor THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = 'ADM03'; END IF;
      IF v_asset.status NOT IN ('pending', 'attached') THEN RAISE EXCEPTION 'asset_not_available' USING ERRCODE = 'ADM22'; END IF;
      -- An asset already attached to a product (or vice versa -- the
      -- product RPC has the mirror check) can never be double-claimed here.
      IF EXISTS (SELECT 1 FROM public.product_images WHERE media_asset_id = v_asset_id) THEN
        RAISE EXCEPTION 'asset_already_used' USING ERRCODE = 'ADM22';
      END IF;
    END IF;
  END LOOP;

  -- Pass 2: replace the whole set. At most 8 rows, so a full delete+insert
  -- is cheap and avoids the same transient unique-index collisions a
  -- partial reorder would hit mid-transaction (idx_hero_images_order_unique).
  --
  -- WHERE id IS NOT NULL: id is the primary key (NOT NULL), so this is
  -- still exactly "every row" -- the explicit WHERE only exists to satisfy
  -- the safe-update protection PostgREST's connection enforces (no bare
  -- DELETE/UPDATE). A plain `DELETE FROM public.hero_images;` passes fine
  -- over a direct psql session (which is how this was verified before
  -- shipping) but fails every time through the real app with
  -- "DELETE requires a WHERE clause" (SQLSTATE 21000) -- that mismatch is
  -- the actual production bug this migration fixes.
  DELETE FROM public.hero_images WHERE id IS NOT NULL;

  v_order := 0;
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_images)
  LOOP
    v_asset_id := NULLIF(v_item->>'mediaAssetId', '')::uuid;
    v_legacy_url := NULLIF(v_item->>'legacyUrl', '');
    v_alt := NULLIF(btrim(COALESCE(v_item->>'alt', '')), '');
    v_enabled := (v_item->>'enabled')::boolean;

    IF v_asset_id IS NOT NULL THEN
      SELECT secure_url INTO v_secure_url FROM public.media_assets WHERE id = v_asset_id;
      INSERT INTO public.hero_images (media_asset_id, url, alt_text, display_order, enabled)
      VALUES (v_asset_id, v_secure_url, v_alt, v_order, v_enabled);

      UPDATE public.media_assets SET status = 'attached', attached_at = now()
      WHERE id = v_asset_id AND status <> 'attached';
    ELSE
      INSERT INTO public.hero_images (media_asset_id, url, alt_text, display_order, enabled)
      VALUES (NULL, v_legacy_url, v_alt, v_order, v_enabled);
    END IF;

    v_order := v_order + 1;
  END LOOP;

  -- Anything that was in the old set and is not in the new one has nowhere
  -- else it could still be attached (the already-used check above is the
  -- only other claimant) -- always safe to mark it a cleanup candidate.
  IF v_old_ids IS NOT NULL THEN
    FOREACH v_removed_id IN ARRAY v_old_ids LOOP
      IF v_removed_id IS NOT NULL AND NOT (v_removed_id = ANY(v_seen_ids)) THEN
        UPDATE public.media_assets SET status = 'orphan_candidate', replaced_at = now()
        WHERE id = v_removed_id AND status = 'attached';
      END IF;
    END LOOP;
  END IF;

  SELECT jsonb_agg(jsonb_build_object('id', id, 'mediaAssetId', media_asset_id, 'url', url, 'alt', alt_text, 'enabled', enabled) ORDER BY display_order)
    INTO v_result
  FROM public.hero_images;
  v_result := COALESCE(v_result, '[]'::jsonb);

  SELECT jsonb_agg(jsonb_build_object('mediaAssetId', media_asset_id, 'enabled', enabled) ORDER BY display_order)
    INTO v_after
  FROM public.hero_images;
  v_after := COALESCE(v_after, '[]'::jsonb);

  IF v_before IS DISTINCT FROM v_after THEN
    INSERT INTO public.admin_audit_events (actor_id, action, entity_type, entity_id, request_id, before_state, after_state)
    VALUES (v_actor, 'hero.images_updated', 'settings', 'hero_content', p_request_id, jsonb_build_object('images', v_before), jsonb_build_object('images', v_after));
  END IF;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION "public"."admin_sync_hero_images"(jsonb, uuid) FROM PUBLIC, "anon", "authenticated";
GRANT EXECUTE ON FUNCTION "public"."admin_sync_hero_images"(jsonb, uuid) TO "authenticated";

COMMIT;
