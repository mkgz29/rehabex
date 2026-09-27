-- ADMIN-02C: product image gallery (up to 5 images), atomic with content and
-- visibility. product_images and media_assets already exist (ADMIN-01B and
-- ADMIN-01C) and are not recreated; this migration only adds the column
-- needed to trace which media_assets row backs each gallery row, a helper
-- RPC that replaces a product's whole gallery inside the caller's own
-- transaction, and extends admin_create_product_with_media /
-- admin_update_product_with_media to call it -- so content, main image and
-- gallery commit together in the exact same way visibility already does
-- since ADMIN-02B.
--
-- product_images.media_asset_id is the only schema change: without it there
-- is no way to tell which media_assets row a gallery row came from, which is
-- required to detect an asset already used by a different product and to
-- correctly mark a removed image's asset as orphan_candidate.
--
-- RELEASE-ADMIN-02-PREFLIGHT fix: a legacy product (image only in
-- products.image_url, zero product_images rows -- true for every product
-- that predates this migration) also gets a one-time backfilled gallery row
-- (media_asset_id NULL) below, and admin_sync_product_gallery accepts that
-- row being carried over via a "legacyUrl" entry. Without both, the first
-- content-only edit to a legacy product after this migration would silently
-- null out its image (see the backfill INSERT's comment for why).

ALTER TABLE "public"."product_images"
  ADD COLUMN IF NOT EXISTS "media_asset_id" uuid REFERENCES "public"."media_assets"("id");

CREATE INDEX IF NOT EXISTS "idx_product_images_media_asset_id" ON "public"."product_images" ("media_asset_id");

-- Legacy backfill: every product created before this migration keeps its
-- image only in products.image_url, with zero product_images rows.
-- admin_sync_product_gallery below always recomputes products.image_url from
-- whichever product_images row is primary -- without this backfill, a
-- product with a real image but no gallery row is indistinguishable from
-- "gallery cleared on purpose", so the very first content-only edit after
-- this migration would silently null out its image. media_asset_id is left
-- NULL because this image was never issued through the ADMIN-01C signed
-- upload flow; admin_sync_product_gallery treats a NULL-media_asset_id row
-- as a carry-over-only "legacy" entry (see legacyUrl below), never as
-- something a client can fabricate.
INSERT INTO "public"."product_images" (product_id, media_asset_id, url, display_order, is_primary)
SELECT p.id, NULL, btrim(p.image_url), 0, true
FROM "public"."products" p
WHERE btrim(COALESCE(p.image_url, '')) <> ''
  AND NOT EXISTS (SELECT 1 FROM "public"."product_images" pi WHERE pi.product_id = p.id);

-- Internal helper: replaces the entire gallery for one product in place.
-- Never granted to any client role -- it is only ever called, in-process, by
-- the two *_with_media wrappers below, which already run as SECURITY
-- DEFINER; re-checking auth here anyway matches this codebase's existing
-- practice of every RPC validating auth/role independently rather than
-- trusting a caller that already did.
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

  -- Pass 1: validate every entry before writing anything. Each entry is
  -- either a media_assets-backed image (mediaAssetId: ownership, "finalized"
  -- status, and not already used by a different product) or a pre-existing
  -- legacy image carried over from before the gallery existed (legacyUrl,
  -- backed by the ADMIN-02C backfill above, media_asset_id IS NULL) --
  -- never both, never neither. A legacyUrl can only ever be an exact match
  -- of a legacy row this same product already has: that is what stops a
  -- client from fabricating an arbitrary image by claiming it is "legacy".
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

  -- Pass 2: replace the whole gallery. Deleting every existing row for this
  -- product before inserting the new set (rather than patching rows in
  -- place) avoids transient collisions with the (product_id, display_order)
  -- and one-primary-per-product unique indexes that a partial reorder would
  -- otherwise hit mid-transaction -- the table has at most 5 rows per
  -- product, so this is cheap.
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

  -- An asset can only ever be attached to one product (enforced by the
  -- already-used check above), so anything that was in the old gallery and
  -- is not in the new one has nowhere else it could still be attached --
  -- always safe to mark it a cleanup candidate. Old legacy rows (NULL here)
  -- never match any media_assets row, so this is a no-op for them.
  IF v_old_ids IS NOT NULL THEN
    FOREACH v_removed_id IN ARRAY v_old_ids LOOP
      IF v_removed_id IS NOT NULL AND NOT (v_removed_id = ANY(v_seen_ids)) THEN
        UPDATE public.media_assets SET status = 'orphan_candidate', replaced_at = now()
        WHERE id = v_removed_id AND status = 'attached';
      END IF;
    END LOOP;
  END IF;

  -- products.image_asset_id/image_url stay the derived, synced view of
  -- "whichever gallery row is primary" -- never an independent input. A
  -- primary legacy row yields image_asset_id = NULL, image_url = its URL,
  -- exactly the pre-gallery shape those columns already had.
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

-- Extend the two product save RPCs: p_image_url/p_image_asset_id are dropped
-- (the primary gallery image is now the only source of truth for a
-- product's main image) and replaced with p_gallery. Old signatures are
-- dropped before the new ones are created, exactly like ADMIN-02B, so no
-- ambiguous overload is ever registered.

DROP FUNCTION IF EXISTS "public"."admin_create_product_with_media"(
  text, text, text, numeric, text, uuid, boolean, integer, boolean, uuid
);

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

DROP FUNCTION IF EXISTS "public"."admin_update_product_with_media"(
  uuid, text, text, text, numeric, text, uuid, boolean, integer, boolean, timestamptz, uuid
);

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
