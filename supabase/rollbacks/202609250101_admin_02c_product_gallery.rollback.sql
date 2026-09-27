-- Manual rollback for 202609250101_admin_02c_product_gallery.sql. Not
-- applied automatically. Restores admin_create_product_with_media /
-- admin_update_product_with_media to their ADMIN-02B signatures (p_image_url
-- / p_image_asset_id, no gallery), drops the gallery-sync helper, and drops
-- product_images.media_asset_id. Dropping that column discards whatever
-- gallery associations exist at rollback time (the product_images rows
-- themselves, and media_assets, are untouched) -- acceptable for a manual,
-- explicitly-authorized rollback, never something to run automatically.

DROP FUNCTION IF EXISTS "public"."admin_create_product_with_media"(
  text, text, text, numeric, boolean, integer, boolean, jsonb, uuid
);

CREATE FUNCTION "public"."admin_create_product_with_media"(
  "p_name" text,
  "p_description" text,
  "p_category" text,
  "p_price" numeric,
  "p_image_url" text,
  "p_image_asset_id" uuid,
  "p_is_featured" boolean,
  "p_display_order" integer,
  "p_is_active" boolean,
  "p_request_id" uuid
) RETURNS "public"."products"
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_asset public.media_assets;
  v_resolved_image_url text := NULLIF(btrim(COALESCE(p_image_url, '')), '');
  v_product public.products;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE = 'ADM01'; END IF;
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = 'ADM03'; END IF;
  IF p_image_asset_id IS NOT NULL AND v_resolved_image_url IS NOT NULL THEN
    RAISE EXCEPTION 'ambiguous_image' USING ERRCODE = 'ADM22';
  END IF;

  IF p_image_asset_id IS NOT NULL THEN
    SELECT * INTO v_asset FROM public.media_assets WHERE id = p_image_asset_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'asset_not_found' USING ERRCODE = 'ADM04'; END IF;
    IF v_asset.created_by <> v_actor THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = 'ADM03'; END IF;
    IF v_asset.status <> 'pending' THEN RAISE EXCEPTION 'asset_not_available' USING ERRCODE = 'ADM22'; END IF;
    v_resolved_image_url := v_asset.secure_url;
  END IF;

  v_product := public.admin_create_product(p_name, p_description, p_category, p_price, v_resolved_image_url, p_is_featured, p_display_order, p_request_id);

  IF p_image_asset_id IS NOT NULL THEN
    UPDATE public.media_assets SET status = 'attached', attached_at = now() WHERE id = p_image_asset_id;
    UPDATE public.products SET image_asset_id = p_image_asset_id WHERE id = v_product.id;

    INSERT INTO public.admin_audit_events (actor_id, action, entity_type, entity_id, request_id, before_state, after_state)
    VALUES (v_actor, 'media.attached', 'media_asset', p_image_asset_id::text, p_request_id, NULL, jsonb_build_object('entity_type', 'product', 'entity_id', v_product.id::text));
  END IF;

  IF COALESCE(p_is_active, false) THEN
    UPDATE public.products SET is_active = true WHERE id = v_product.id;

    INSERT INTO public.admin_audit_events (actor_id, action, entity_type, entity_id, request_id, before_state, after_state)
    VALUES (v_actor, 'product.activated', 'product', v_product.id::text, p_request_id, jsonb_build_object('is_active', false), jsonb_build_object('is_active', true));
  END IF;

  SELECT * INTO v_product FROM public.products WHERE id = v_product.id;
  RETURN v_product;
END;
$$;

DROP FUNCTION IF EXISTS "public"."admin_update_product_with_media"(
  uuid, text, text, text, numeric, boolean, integer, boolean, jsonb, timestamptz, uuid
);

CREATE FUNCTION "public"."admin_update_product_with_media"(
  "p_product_id" uuid,
  "p_name" text,
  "p_description" text,
  "p_category" text,
  "p_price" numeric,
  "p_image_url" text,
  "p_image_asset_id" uuid,
  "p_is_featured" boolean,
  "p_display_order" integer,
  "p_is_active" boolean,
  "p_expected_updated_at" timestamptz,
  "p_request_id" uuid
) RETURNS "public"."products"
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_asset public.media_assets;
  v_resolved_image_url text := NULLIF(btrim(COALESCE(p_image_url, '')), '');
  v_old_asset_id uuid;
  v_product public.products;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE = 'ADM01'; END IF;
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = 'ADM03'; END IF;
  IF p_image_asset_id IS NOT NULL AND v_resolved_image_url IS NOT NULL THEN
    RAISE EXCEPTION 'ambiguous_image' USING ERRCODE = 'ADM22';
  END IF;

  SELECT image_asset_id INTO v_old_asset_id FROM public.products WHERE id = p_product_id;

  IF p_image_asset_id IS NOT NULL THEN
    SELECT * INTO v_asset FROM public.media_assets WHERE id = p_image_asset_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'asset_not_found' USING ERRCODE = 'ADM04'; END IF;
    IF v_asset.created_by <> v_actor THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = 'ADM03'; END IF;
    IF v_asset.status <> 'pending' THEN RAISE EXCEPTION 'asset_not_available' USING ERRCODE = 'ADM22'; END IF;
    v_resolved_image_url := v_asset.secure_url;
  END IF;

  v_product := public.admin_update_product(p_product_id, p_name, p_description, p_category, p_price, v_resolved_image_url, p_is_featured, p_display_order, p_expected_updated_at, p_request_id);

  IF p_image_asset_id IS NOT NULL AND p_image_asset_id IS DISTINCT FROM v_old_asset_id THEN
    UPDATE public.media_assets SET status = 'attached', attached_at = now() WHERE id = p_image_asset_id;
    UPDATE public.products SET image_asset_id = p_image_asset_id WHERE id = v_product.id;

    INSERT INTO public.admin_audit_events (actor_id, action, entity_type, entity_id, request_id, before_state, after_state)
    VALUES (v_actor, 'media.attached', 'media_asset', p_image_asset_id::text, p_request_id, NULL, jsonb_build_object('entity_type', 'product', 'entity_id', v_product.id::text));

    IF v_old_asset_id IS NOT NULL THEN
      UPDATE public.media_assets SET status = 'orphan_candidate', replaced_at = now() WHERE id = v_old_asset_id AND status = 'attached';

      INSERT INTO public.admin_audit_events (actor_id, action, entity_type, entity_id, request_id, before_state, after_state)
      VALUES (v_actor, 'media.orphaned', 'media_asset', v_old_asset_id::text, p_request_id, jsonb_build_object('status', 'attached'), jsonb_build_object('status', 'orphan_candidate', 'replaced_by', p_image_asset_id::text));
    END IF;
  END IF;

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
  RETURN v_product;
END;
$$;

REVOKE ALL ON FUNCTION "public"."admin_create_product_with_media"(text, text, text, numeric, text, uuid, boolean, integer, boolean, uuid) FROM PUBLIC, "anon", "authenticated";
REVOKE ALL ON FUNCTION "public"."admin_update_product_with_media"(uuid, text, text, text, numeric, text, uuid, boolean, integer, boolean, timestamptz, uuid) FROM PUBLIC, "anon", "authenticated";

GRANT EXECUTE ON FUNCTION "public"."admin_create_product_with_media"(text, text, text, numeric, text, uuid, boolean, integer, boolean, uuid) TO "authenticated";
GRANT EXECUTE ON FUNCTION "public"."admin_update_product_with_media"(uuid, text, text, text, numeric, text, uuid, boolean, integer, boolean, timestamptz, uuid) TO "authenticated";

DROP FUNCTION IF EXISTS "public"."admin_sync_product_gallery"(uuid, jsonb, uuid);

ALTER TABLE "public"."product_images" DROP COLUMN IF EXISTS "media_asset_id";
