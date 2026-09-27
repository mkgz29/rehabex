-- ADMIN-02E: full editorial content + image framing + featured-products
-- curation. Nothing here creates a new table: framing is metadata on an
-- existing row (product_images) or inside an existing settings document
-- (hero_content/about_content), and "featured" curation reuses the existing
-- products.is_featured/display_order columns as the single source of truth
-- (never duplicated into settings).

-- 1. Settings key allowlist: two new editorial documents (title/subtitle for
-- the public "Productos destacados" and "Catálogo Rehabex" sections). Both
-- admin_upsert_settings_document(_with_media) hardcode an allowlist rather
-- than accepting an arbitrary key from the client; CREATE OR REPLACE keeps
-- the same signature; no ambiguous overload is created.
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
  IF p_key NOT IN ('hero_content', 'about_content', 'featured_section_content', 'catalog_section_content') THEN
    RAISE EXCEPTION 'invalid_key' USING ERRCODE = 'ADM22';
  END IF;

  v_action := p_key || '.updated';

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

-- admin_upsert_settings_document_with_media only special-cases hero_content/
-- about_content's image field and delegates everything else to the function
-- above -- it needs no change: featured_section_content/catalog_section_
-- content are always written through the plain (non-media) endpoint, which
-- now accepts them.

REVOKE ALL ON FUNCTION "public"."admin_upsert_settings_document"(text, jsonb, timestamptz, uuid) FROM PUBLIC, "anon", "authenticated";
GRANT EXECUTE ON FUNCTION "public"."admin_upsert_settings_document"(text, jsonb, timestamptz, uuid) TO "authenticated";

-- 2. Image framing on product_images. One JSONB column, matching the shape
-- already used inside hero_content/about_content ({mode, focalX, focalY,
-- zoom}), so the same normalizeFraming() defaults apply everywhere. The
-- column default gives every existing row (including RELEASE-ADMIN-02-
-- PREFLIGHT's backfilled legacy rows) centered/fill/normal-zoom without a
-- backfill UPDATE, and without ever changing how an unedited image looks.
ALTER TABLE "public"."product_images"
  ADD COLUMN IF NOT EXISTS "framing" jsonb NOT NULL DEFAULT '{"mode":"fill","focalX":0.5,"focalY":0.5,"zoom":1}'::jsonb;

-- 3. admin_sync_product_gallery: each gallery item may now also carry an
-- optional "framing" object (validated: mode in fill/contain, focalX/focalY
-- in [0,1], zoom in [1,3]); an absent or malformed one falls back to the
-- same default the column itself defaults to. Everything else (mediaAssetId/
-- legacyUrl validation, atomicity, orphaning) is unchanged from
-- 202609250101's RELEASE-ADMIN-02-PREFLIGHT fix.
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
  v_framing jsonb;
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

  SELECT jsonb_agg(jsonb_build_object('mediaAssetId', media_asset_id, 'isPrimary', is_primary, 'framing', framing) ORDER BY display_order)
    INTO v_before
  FROM public.product_images WHERE product_id = p_product_id;
  v_before := COALESCE(v_before, '[]'::jsonb);

  SELECT array_agg(media_asset_id) INTO v_old_ids FROM public.product_images WHERE product_id = p_product_id;

  -- Pass 1: validate every entry before writing anything.
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

    IF v_item ? 'framing' AND jsonb_typeof(v_item->'framing') = 'object' THEN
      IF (v_item->'framing'->>'mode') NOT IN ('fill', 'contain') THEN RAISE EXCEPTION 'invalid_gallery' USING ERRCODE = 'ADM22'; END IF;
      IF NOT (
        (v_item->'framing'->>'focalX')::numeric BETWEEN 0 AND 1 AND
        (v_item->'framing'->>'focalY')::numeric BETWEEN 0 AND 1 AND
        (v_item->'framing'->>'zoom')::numeric BETWEEN 1 AND 3
      ) THEN RAISE EXCEPTION 'invalid_gallery' USING ERRCODE = 'ADM22'; END IF;
    ELSIF v_item ? 'framing' THEN
      RAISE EXCEPTION 'invalid_gallery' USING ERRCODE = 'ADM22';
    END IF;

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

  -- Pass 2: replace the whole gallery.
  DELETE FROM public.product_images WHERE product_id = p_product_id;

  v_order := 0;
  v_primary_asset_id := NULL;
  v_primary_url := NULL;
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_gallery)
  LOOP
    v_asset_id := NULLIF(v_item->>'mediaAssetId', '')::uuid;
    v_legacy_url := NULLIF(v_item->>'legacyUrl', '');
    v_is_primary := COALESCE((v_item->>'isPrimary')::boolean, false);
    v_framing := CASE
      WHEN v_item ? 'framing' AND jsonb_typeof(v_item->'framing') = 'object' THEN v_item->'framing'
      ELSE '{"mode":"fill","focalX":0.5,"focalY":0.5,"zoom":1}'::jsonb
    END;

    IF v_asset_id IS NOT NULL THEN
      SELECT secure_url INTO v_secure_url FROM public.media_assets WHERE id = v_asset_id;

      INSERT INTO public.product_images (product_id, media_asset_id, url, display_order, is_primary, framing)
      VALUES (p_product_id, v_asset_id, v_secure_url, v_order, v_is_primary, v_framing);

      IF v_is_primary THEN
        v_primary_asset_id := v_asset_id;
        v_primary_url := v_secure_url;
      END IF;

      UPDATE public.media_assets SET status = 'attached', attached_at = now()
      WHERE id = v_asset_id AND status <> 'attached';
    ELSE
      INSERT INTO public.product_images (product_id, media_asset_id, url, display_order, is_primary, framing)
      VALUES (p_product_id, NULL, v_legacy_url, v_order, v_is_primary, v_framing);

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

  SELECT jsonb_agg(jsonb_build_object('mediaAssetId', media_asset_id, 'isPrimary', is_primary, 'framing', framing) ORDER BY display_order)
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

-- admin_create_product_with_media / admin_update_product_with_media: same
-- signatures as ADMIN-02C (no DROP needed, no ambiguous overload risk), only
-- their returned gallery JSON now also includes each row's framing so the
-- panel can show a just-saved gallery's positions without a second fetch.
CREATE OR REPLACE FUNCTION "public"."admin_create_product_with_media"(
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

  v_product := public.admin_create_product(p_name, p_description, p_category, p_price, NULL, p_is_featured, p_display_order, p_request_id);

  PERFORM public.admin_sync_product_gallery(v_product.id, COALESCE(p_gallery, '[]'::jsonb), p_request_id);

  IF COALESCE(p_is_active, false) THEN
    UPDATE public.products SET is_active = true WHERE id = v_product.id;

    INSERT INTO public.admin_audit_events (actor_id, action, entity_type, entity_id, request_id, before_state, after_state)
    VALUES (v_actor, 'product.activated', 'product', v_product.id::text, p_request_id, jsonb_build_object('is_active', false), jsonb_build_object('is_active', true));
  END IF;

  SELECT * INTO v_product FROM public.products WHERE id = v_product.id;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('mediaAssetId', media_asset_id, 'url', url, 'isPrimary', is_primary, 'displayOrder', display_order, 'framing', framing) ORDER BY display_order), '[]'::jsonb)
    INTO v_gallery
  FROM public.product_images WHERE product_id = v_product.id;

  RETURN jsonb_build_object('product', to_jsonb(v_product), 'gallery', v_gallery);
END;
$$;

CREATE OR REPLACE FUNCTION "public"."admin_update_product_with_media"(
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
  SELECT COALESCE(jsonb_agg(jsonb_build_object('mediaAssetId', media_asset_id, 'url', url, 'isPrimary', is_primary, 'displayOrder', display_order, 'framing', framing) ORDER BY display_order), '[]'::jsonb)
    INTO v_gallery
  FROM public.product_images WHERE product_id = p_product_id;

  RETURN jsonb_build_object('product', to_jsonb(v_product), 'gallery', v_gallery);
END;
$$;

-- 4. admin_set_featured_products: atomic bulk curation of the public
-- "Productos destacados" selection and its order. Single source of truth
-- stays products.is_featured/display_order (never duplicated into
-- settings); this only ever updates the rows the caller explicitly lists,
-- leaving every other product's own order untouched. A hidden or TEST/
-- PRUEBA-category product can never be marked featured -- both raise a
-- specific, distinct error code the UI turns into a plain-language
-- explanation, instead of silently no-op'ing or exposing a test fixture
-- publicly.
CREATE FUNCTION "public"."admin_set_featured_products"(
  "p_items" jsonb,
  "p_request_id" uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_item jsonb;
  v_product_id uuid;
  v_is_featured boolean;
  v_display_order integer;
  v_product public.products;
  v_seen_ids uuid[] := ARRAY[]::uuid[];
  v_before jsonb;
  v_after jsonb;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE = 'ADM01'; END IF;
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = 'ADM03'; END IF;
  IF p_request_id IS NULL OR jsonb_typeof(p_items) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'invalid_request' USING ERRCODE = 'ADM22';
  END IF;
  IF jsonb_array_length(p_items) = 0 THEN
    RETURN jsonb_build_object('updated', 0);
  END IF;
  IF jsonb_array_length(p_items) > 100 THEN RAISE EXCEPTION 'too_many_items' USING ERRCODE = 'ADM22'; END IF;

  SELECT jsonb_agg(jsonb_build_object('id', id, 'isFeatured', is_featured, 'displayOrder', display_order) ORDER BY id)
    INTO v_before
  FROM public.products WHERE is_featured = true;
  v_before := COALESCE(v_before, '[]'::jsonb);

  -- Pass 1: validate every entry before writing anything.
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    IF jsonb_typeof(v_item) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'invalid_request' USING ERRCODE = 'ADM22'; END IF;

    v_product_id := NULLIF(v_item->>'id', '')::uuid;
    IF v_product_id IS NULL THEN RAISE EXCEPTION 'invalid_request' USING ERRCODE = 'ADM22'; END IF;
    IF v_product_id = ANY(v_seen_ids) THEN RAISE EXCEPTION 'duplicate_product' USING ERRCODE = 'ADM22'; END IF;
    v_seen_ids := array_append(v_seen_ids, v_product_id);

    IF jsonb_typeof(v_item->'isFeatured') IS DISTINCT FROM 'boolean' THEN RAISE EXCEPTION 'invalid_request' USING ERRCODE = 'ADM22'; END IF;
    IF jsonb_typeof(v_item->'displayOrder') IS DISTINCT FROM 'number' THEN RAISE EXCEPTION 'invalid_request' USING ERRCODE = 'ADM22'; END IF;
    v_is_featured := (v_item->>'isFeatured')::boolean;
    v_display_order := (v_item->>'displayOrder')::integer;
    IF v_display_order < 0 OR v_display_order > 100000 THEN RAISE EXCEPTION 'invalid_request' USING ERRCODE = 'ADM22'; END IF;

    SELECT * INTO v_product FROM public.products WHERE id = v_product_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'not_found' USING ERRCODE = 'ADM04'; END IF;

    IF v_is_featured THEN
      IF NOT v_product.is_active THEN RAISE EXCEPTION 'hidden_product_cannot_feature' USING ERRCODE = 'ADM22'; END IF;
      IF lower(btrim(COALESCE(v_product.category, ''))) = ANY (ARRAY['test', 'prueba']) THEN
        RAISE EXCEPTION 'reserved_category' USING ERRCODE = 'ADM22';
      END IF;
    END IF;
  END LOOP;

  -- Pass 2: apply. Only the listed products are touched.
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    UPDATE public.products
    SET is_featured = (v_item->>'isFeatured')::boolean, display_order = (v_item->>'displayOrder')::integer
    WHERE id = (v_item->>'id')::uuid;
  END LOOP;

  SELECT jsonb_agg(jsonb_build_object('id', id, 'isFeatured', is_featured, 'displayOrder', display_order) ORDER BY id)
    INTO v_after
  FROM public.products WHERE is_featured = true;
  v_after := COALESCE(v_after, '[]'::jsonb);

  IF v_before IS DISTINCT FROM v_after THEN
    INSERT INTO public.admin_audit_events (actor_id, action, entity_type, entity_id, request_id, before_state, after_state)
    VALUES (v_actor, 'products.featured_updated', 'product', 'bulk', p_request_id, jsonb_build_object('featured', v_before), jsonb_build_object('featured', v_after));
  END IF;

  RETURN jsonb_build_object('updated', jsonb_array_length(p_items));
END;
$$;

REVOKE ALL ON FUNCTION "public"."admin_set_featured_products"(jsonb, uuid) FROM PUBLIC, "anon", "authenticated";
GRANT EXECUTE ON FUNCTION "public"."admin_set_featured_products"(jsonb, uuid) TO "authenticated";
