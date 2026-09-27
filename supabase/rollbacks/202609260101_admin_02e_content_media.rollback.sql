-- Manual rollback for 202609260101_admin_02e_content_media.sql. Not applied
-- automatically. Restores admin_upsert_settings_document's allowlist to
-- hero_content/about_content only, restores admin_sync_product_gallery to
-- its pre-ADMIN-02E body (no framing field), drops admin_set_featured_
-- products entirely, and drops product_images.framing.
--
-- Framing data loss on rollback: dropping product_images.framing discards
-- whatever custom positioning admins configured for product gallery images.
-- featured_section_content/catalog_section_content rows (if any were ever
-- written) are left in place in "settings" -- inert once this rollback's
-- allowlist no longer accepts writes to them, but not deleted, so no
-- accidental data loss beyond the framing column itself. products.
-- is_featured/display_order (the featured-curation source of truth) are
-- untouched by this rollback, since admin_set_featured_products only ever
-- wrote to those pre-existing columns.

CREATE OR REPLACE FUNCTION "public"."admin_upsert_settings_document"(
  "p_key" text,
  "p_value" jsonb,
  "p_expected_updated_at" timestamptz,
  "p_request_id" uuid
) RETURNS "public"."settings"
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_before public.settings;
  v_after public.settings;
  v_action text;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE = 'ADM01'; END IF;
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = 'ADM03'; END IF;
  IF p_key IS NULL OR p_value IS NULL OR p_request_id IS NULL THEN RAISE EXCEPTION 'invalid_request' USING ERRCODE = 'ADM22'; END IF;
  IF p_key NOT IN ('hero_content', 'about_content') THEN RAISE EXCEPTION 'invalid_key' USING ERRCODE = 'ADM22'; END IF;

  v_action := CASE WHEN p_key = 'hero_content' THEN 'hero.updated' ELSE 'about.updated' END;

  SELECT * INTO v_before FROM public.settings WHERE key = p_key FOR UPDATE;

  IF NOT FOUND THEN
    IF p_expected_updated_at IS NOT NULL THEN RAISE EXCEPTION 'version_conflict' USING ERRCODE = 'ADM09'; END IF;

    INSERT INTO public.settings (key, value) VALUES (p_key, p_value) RETURNING * INTO v_after;

    INSERT INTO public.admin_audit_events (actor_id, action, entity_type, entity_id, request_id, before_state, after_state)
    VALUES (v_actor, v_action, 'settings', p_key, p_request_id, NULL, v_after.value);

    RETURN v_after;
  END IF;

  IF p_expected_updated_at IS NULL OR v_before.updated_at <> p_expected_updated_at THEN
    RAISE EXCEPTION 'version_conflict' USING ERRCODE = 'ADM09';
  END IF;

  IF v_before.value = p_value THEN
    RETURN v_before;
  END IF;

  UPDATE public.settings SET value = p_value WHERE key = p_key RETURNING * INTO v_after;

  INSERT INTO public.admin_audit_events (actor_id, action, entity_type, entity_id, request_id, before_state, after_state)
  VALUES (v_actor, v_action, 'settings', p_key, p_request_id, v_before.value, v_after.value);

  RETURN v_after;
EXCEPTION
  WHEN unique_violation THEN RAISE EXCEPTION 'duplicate_request' USING ERRCODE = 'ADM09';
END;
$$;

REVOKE ALL ON FUNCTION "public"."admin_upsert_settings_document"(text, jsonb, timestamptz, uuid) FROM PUBLIC, "anon", "authenticated";
GRANT EXECUTE ON FUNCTION "public"."admin_upsert_settings_document"(text, jsonb, timestamptz, uuid) TO "authenticated";

CREATE OR REPLACE FUNCTION "public"."admin_sync_product_gallery"(
  "p_product_id" uuid,
  "p_gallery" jsonb,
  "p_request_id" uuid
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_count integer;
  v_primary_count integer := 0;
  v_item jsonb;
  v_asset_id uuid;
  v_legacy_url text;
  v_is_legacy boolean;
  v_is_primary boolean;
  v_order integer;
  v_seen_ids uuid[] := ARRAY[]::uuid[];
  v_seen_urls text[] := ARRAY[]::text[];
  v_asset public.media_assets;
  v_secure_url text;
  v_primary_asset_id uuid;
  v_primary_url text;
  v_old_ids uuid[];
  v_removed_id uuid;
  v_before jsonb;
  v_after jsonb;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE = 'ADM01'; END IF;
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = 'ADM03'; END IF;
  IF p_product_id IS NULL OR p_request_id IS NULL OR jsonb_typeof(p_gallery) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'invalid_gallery' USING ERRCODE = 'ADM22';
  END IF;

  v_count := jsonb_array_length(p_gallery);
  IF v_count > 5 THEN RAISE EXCEPTION 'too_many_images' USING ERRCODE = 'ADM22'; END IF;

  SELECT jsonb_agg(jsonb_build_object('mediaAssetId', media_asset_id, 'isPrimary', is_primary) ORDER BY display_order)
    INTO v_before
  FROM public.product_images WHERE product_id = p_product_id;
  v_before := COALESCE(v_before, '[]'::jsonb);

  SELECT array_agg(media_asset_id) INTO v_old_ids FROM public.product_images WHERE product_id = p_product_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_gallery)
  LOOP
    IF jsonb_typeof(v_item) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'invalid_gallery' USING ERRCODE = 'ADM22'; END IF;

    v_asset_id := NULLIF(v_item->>'mediaAssetId', '')::uuid;
    v_legacy_url := NULLIF(v_item->>'legacyUrl', '');
    v_is_legacy := v_legacy_url IS NOT NULL;
    IF (v_asset_id IS NULL) = (v_legacy_url IS NULL) THEN
      RAISE EXCEPTION 'invalid_gallery' USING ERRCODE = 'ADM22';
    END IF;

    v_is_primary := COALESCE((v_item->>'isPrimary')::boolean, false);
    IF v_is_primary THEN v_primary_count := v_primary_count + 1; END IF;

    IF v_is_legacy THEN
      IF v_legacy_url = ANY(v_seen_urls) THEN RAISE EXCEPTION 'duplicate_image' USING ERRCODE = 'ADM22'; END IF;
      v_seen_urls := array_append(v_seen_urls, v_legacy_url);

      IF NOT EXISTS (
        SELECT 1 FROM public.product_images
        WHERE product_id = p_product_id AND media_asset_id IS NULL AND url = v_legacy_url
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
      IF EXISTS (
        SELECT 1 FROM public.product_images
        WHERE media_asset_id = v_asset_id AND product_id <> p_product_id
      ) THEN RAISE EXCEPTION 'asset_already_used' USING ERRCODE = 'ADM22'; END IF;
    END IF;
  END LOOP;

  IF v_count > 0 AND v_primary_count <> 1 THEN
    RAISE EXCEPTION 'invalid_primary' USING ERRCODE = 'ADM22';
  END IF;

  DELETE FROM public.product_images WHERE product_id = p_product_id;

  v_order := 0;
  v_primary_asset_id := NULL;
  v_primary_url := NULL;
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_gallery)
  LOOP
    v_asset_id := NULLIF(v_item->>'mediaAssetId', '')::uuid;
    v_legacy_url := NULLIF(v_item->>'legacyUrl', '');
    v_is_primary := COALESCE((v_item->>'isPrimary')::boolean, false);

    IF v_asset_id IS NOT NULL THEN
      SELECT secure_url INTO v_secure_url FROM public.media_assets WHERE id = v_asset_id;

      INSERT INTO public.product_images (product_id, media_asset_id, url, display_order, is_primary)
      VALUES (p_product_id, v_asset_id, v_secure_url, v_order, v_is_primary);

      IF v_is_primary THEN
        v_primary_asset_id := v_asset_id;
        v_primary_url := v_secure_url;
      END IF;

      UPDATE public.media_assets SET status = 'attached', attached_at = now()
      WHERE id = v_asset_id AND status <> 'attached';
    ELSE
      INSERT INTO public.product_images (product_id, media_asset_id, url, display_order, is_primary)
      VALUES (p_product_id, NULL, v_legacy_url, v_order, v_is_primary);

      IF v_is_primary THEN
        v_primary_asset_id := NULL;
        v_primary_url := v_legacy_url;
      END IF;
    END IF;

    v_order := v_order + 1;
  END LOOP;

  IF v_old_ids IS NOT NULL THEN
    FOREACH v_removed_id IN ARRAY v_old_ids LOOP
      IF v_removed_id IS NOT NULL AND NOT (v_removed_id = ANY(v_seen_ids)) THEN
        UPDATE public.media_assets SET status = 'orphan_candidate', replaced_at = now()
        WHERE id = v_removed_id AND status = 'attached';
      END IF;
    END LOOP;
  END IF;

  UPDATE public.products SET image_asset_id = v_primary_asset_id, image_url = v_primary_url WHERE id = p_product_id;

  SELECT jsonb_agg(jsonb_build_object('mediaAssetId', media_asset_id, 'isPrimary', is_primary) ORDER BY display_order)
    INTO v_after
  FROM public.product_images WHERE product_id = p_product_id;
  v_after := COALESCE(v_after, '[]'::jsonb);

  IF v_before IS DISTINCT FROM v_after THEN
    INSERT INTO public.admin_audit_events (actor_id, action, entity_type, entity_id, request_id, before_state, after_state)
    VALUES (v_actor, 'product.gallery_updated', 'product', p_product_id::text, p_request_id, jsonb_build_object('gallery', v_before), jsonb_build_object('gallery', v_after));
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION "public"."admin_sync_product_gallery"(uuid, jsonb, uuid) FROM PUBLIC, "anon", "authenticated";

DROP FUNCTION IF EXISTS "public"."admin_set_featured_products"(jsonb, uuid);

ALTER TABLE "public"."product_images" DROP COLUMN IF EXISTS "framing";
