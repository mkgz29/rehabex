-- Manual rollback for 202609240101_admin_02b_atomic_product_visibility.sql.
-- Not applied automatically. Restores the exact ADMIN-01C signatures and
-- bodies of admin_create_product_with_media / admin_update_product_with_media
-- (the two-request save flow), dropping the ADMIN-02B (is_active-accepting)
-- versions first to avoid leaving two overloads registered at once.

DROP FUNCTION IF EXISTS "public"."admin_create_product_with_media"(
  text, text, text, numeric, text, uuid, boolean, integer, boolean, uuid
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

    SELECT * INTO v_product FROM public.products WHERE id = v_product.id;
  END IF;

  RETURN v_product;
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
  "p_image_url" text,
  "p_image_asset_id" uuid,
  "p_is_featured" boolean,
  "p_display_order" integer,
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

    SELECT * INTO v_product FROM public.products WHERE id = v_product.id;
  END IF;

  RETURN v_product;
END;
$$;

REVOKE ALL ON FUNCTION "public"."admin_create_product_with_media"(text, text, text, numeric, text, uuid, boolean, integer, uuid) FROM PUBLIC, "anon", "authenticated";
REVOKE ALL ON FUNCTION "public"."admin_update_product_with_media"(uuid, text, text, text, numeric, text, uuid, boolean, integer, timestamptz, uuid) FROM PUBLIC, "anon", "authenticated";

GRANT EXECUTE ON FUNCTION "public"."admin_create_product_with_media"(text, text, text, numeric, text, uuid, boolean, integer, uuid) TO "authenticated";
GRANT EXECUTE ON FUNCTION "public"."admin_update_product_with_media"(uuid, text, text, text, numeric, text, uuid, boolean, integer, timestamptz, uuid) TO "authenticated";
