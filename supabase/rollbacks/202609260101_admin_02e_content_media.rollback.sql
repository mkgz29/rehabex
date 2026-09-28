-- Manual rollback for 202609260101_admin_02e_content_media.sql. Not applied
-- automatically. Restores every gallery RPC to its ADMIN-02C body before
-- dropping product_images.framing, drops admin_set_featured_products, and
-- restores admin_upsert_settings_document's allowlist to hero_content/
-- about_content only. The rollback is therefore safe to run on its own;
-- rolling back ADMIN-02C afterwards is not required for product saves to
-- keep working.
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

-- The ADMIN-02E wrappers serialize product_images.framing. Remove them
-- before replacing the helper or dropping the column so no callable body
-- can retain a dependency on framing at any point after this section.
DROP FUNCTION IF EXISTS "public"."admin_create_product_with_media"(
  text, text, text, numeric, boolean, integer, boolean, jsonb, uuid
);

DROP FUNCTION IF EXISTS "public"."admin_update_product_with_media"(
  uuid, text, text, text, numeric, boolean, integer, boolean, jsonb, timestamptz, uuid
);

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

-- Restore the final ADMIN-02C product-save wrappers. Their signatures,
-- bodies, SECURITY DEFINER posture, empty search_path and grants match the
-- migration that introduced the gallery contract.
CREATE FUNCTION "public"."admin_create_product_with_media"(
  "p_name" text,
  "p_description" text,
  "p_category" text,
  "p_price" numeric,
  "p_is_featured" boolean,
  "p_display_order" integer,
  "p_is_active" boolean,
  "p_gallery" jsonb,
  "p_request_id" uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_product public.products;
  v_gallery jsonb;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE = 'ADM01'; END IF;
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = 'ADM03'; END IF;

  -- No image yet: the gallery sync below resolves the real image_url from
  -- whichever entry (if any) is primary, in this same transaction.
  v_product := public.admin_create_product(p_name, p_description, p_category, p_price, NULL, p_is_featured, p_display_order, p_request_id);

  PERFORM public.admin_sync_product_gallery(v_product.id, COALESCE(p_gallery, '[]'::jsonb), p_request_id);

  IF COALESCE(p_is_active, false) THEN
    UPDATE public.products SET is_active = true WHERE id = v_product.id;

    INSERT INTO public.admin_audit_events (actor_id, action, entity_type, entity_id, request_id, before_state, after_state)
    VALUES (v_actor, 'product.activated', 'product', v_product.id::text, p_request_id, jsonb_build_object('is_active', false), jsonb_build_object('is_active', true));
  END IF;

  SELECT * INTO v_product FROM public.products WHERE id = v_product.id;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('mediaAssetId', media_asset_id, 'url', url, 'isPrimary', is_primary, 'displayOrder', display_order) ORDER BY display_order), '[]'::jsonb)
    INTO v_gallery
  FROM public.product_images WHERE product_id = v_product.id;

  -- Returned as one JSON result -- product and gallery together, reflecting
  -- exactly what this single transaction committed -- rather than a second,
  -- separate read the client would have to make (and could see a stale or
  -- partial state from if it raced another request).
  RETURN jsonb_build_object('product', to_jsonb(v_product), 'gallery', v_gallery);
END;
$$;

CREATE FUNCTION "public"."admin_update_product_with_media"(
  "p_product_id" uuid,
  "p_name" text,
  "p_description" text,
  "p_category" text,
  "p_price" numeric,
  "p_is_featured" boolean,
  "p_display_order" integer,
  "p_is_active" boolean,
  "p_gallery" jsonb,
  "p_expected_updated_at" timestamptz,
  "p_request_id" uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_current_image_url text;
  v_product public.products;
  v_gallery jsonb;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE = 'ADM01'; END IF;
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = 'ADM03'; END IF;

  -- Pass the row's own current image_url through unchanged so
  -- admin_update_product's "did anything actually change" comparison is not
  -- thrown off by a param that no longer independently carries the image;
  -- the gallery sync below is what actually resolves the final image_url,
  -- and audits its own before/after separately.
  SELECT image_url INTO v_current_image_url FROM public.products WHERE id = p_product_id;

  v_product := public.admin_update_product(p_product_id, p_name, p_description, p_category, p_price, v_current_image_url, p_is_featured, p_display_order, p_expected_updated_at, p_request_id);

  PERFORM public.admin_sync_product_gallery(p_product_id, COALESCE(p_gallery, '[]'::jsonb), p_request_id);

  IF COALESCE(p_is_active, v_product.is_active) IS DISTINCT FROM v_product.is_active THEN
    IF p_is_active THEN
      IF v_product.name IS NULL OR btrim(v_product.name) = '' THEN RAISE EXCEPTION 'invalid_name' USING ERRCODE = 'ADM22'; END IF;
      IF v_product.price IS NULL OR v_product.price <= 0 THEN RAISE EXCEPTION 'invalid_price' USING ERRCODE = 'ADM22'; END IF;
      IF v_product.category IS NULL OR btrim(v_product.category) = '' THEN RAISE EXCEPTION 'invalid_category' USING ERRCODE = 'ADM22'; END IF;
      IF lower(btrim(v_product.category)) = ANY (ARRAY['test', 'prueba']) THEN RAISE EXCEPTION 'reserved_category' USING ERRCODE = 'ADM22'; END IF;
    END IF;

    UPDATE public.products SET is_active = p_is_active WHERE id = p_product_id;

    INSERT INTO public.admin_audit_events (actor_id, action, entity_type, entity_id, request_id, before_state, after_state)
    VALUES (
      v_actor,
      CASE WHEN p_is_active THEN 'product.activated' ELSE 'product.deactivated' END,
      'product', p_product_id::text, p_request_id,
      jsonb_build_object('is_active', v_product.is_active),
      jsonb_build_object('is_active', p_is_active)
    );
  END IF;

  SELECT * INTO v_product FROM public.products WHERE id = p_product_id;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('mediaAssetId', media_asset_id, 'url', url, 'isPrimary', is_primary, 'displayOrder', display_order) ORDER BY display_order), '[]'::jsonb)
    INTO v_gallery
  FROM public.product_images WHERE product_id = p_product_id;

  RETURN jsonb_build_object('product', to_jsonb(v_product), 'gallery', v_gallery);
END;
$$;

REVOKE ALL ON FUNCTION "public"."admin_create_product_with_media"(text, text, text, numeric, boolean, integer, boolean, jsonb, uuid) FROM PUBLIC, "anon", "authenticated";
REVOKE ALL ON FUNCTION "public"."admin_update_product_with_media"(uuid, text, text, text, numeric, boolean, integer, boolean, jsonb, timestamptz, uuid) FROM PUBLIC, "anon", "authenticated";

GRANT EXECUTE ON FUNCTION "public"."admin_create_product_with_media"(text, text, text, numeric, boolean, integer, boolean, jsonb, uuid) TO "authenticated";
GRANT EXECUTE ON FUNCTION "public"."admin_update_product_with_media"(uuid, text, text, text, numeric, boolean, integer, boolean, jsonb, timestamptz, uuid) TO "authenticated";

-- No function body now references framing, so the column can be removed
-- without leaving a latent runtime failure in the ADMIN-02C contract.
ALTER TABLE "public"."product_images" DROP COLUMN IF EXISTS "framing";

DROP FUNCTION IF EXISTS "public"."admin_set_featured_products"(jsonb, uuid);

-- Restore the pre-ADMIN-02E settings allowlist last, after every exclusive
-- ADMIN-02E database capability has been removed.
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
