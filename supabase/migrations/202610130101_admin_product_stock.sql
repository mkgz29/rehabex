BEGIN;

-- FASE 7D.3-B1: wires the admin panel to products.stock_on_hand, which
-- already exists (202609110102) with CHECK (stock_on_hand >= 0) and
-- DEFAULT 0 -- no column migration here, only the four product RPCs. Adding
-- a new parameter changes each function's identity signature, so this is an
-- explicit DROP + CREATE, not a CREATE OR REPLACE (which would otherwise
-- create a second, ambiguous overload alongside the old one instead of
-- truly replacing it).
--
-- stock_reservations / inventory_movements / create_order /
-- consume_order_reservation are untouched: they already read
-- products.stock_on_hand directly and need no changes to start reflecting
-- whatever the admin now saves.

DROP FUNCTION "public"."admin_create_product_with_media"(text, text, text, numeric, boolean, integer, boolean, jsonb, uuid);
DROP FUNCTION "public"."admin_update_product_with_media"(uuid, text, text, text, numeric, boolean, integer, boolean, jsonb, timestamptz, uuid);
DROP FUNCTION "public"."admin_create_product"(text, text, text, numeric, text, boolean, integer, uuid);
DROP FUNCTION "public"."admin_update_product"(uuid, text, text, text, numeric, text, boolean, integer, timestamptz, uuid);

CREATE FUNCTION "public"."admin_create_product"(
  "p_name" text,
  "p_description" text,
  "p_category" text,
  "p_price" numeric,
  "p_image_url" text,
  "p_is_featured" boolean,
  "p_display_order" integer,
  "p_stock_on_hand" integer,
  "p_request_id" uuid
) RETURNS "public"."products"
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_name text := btrim(COALESCE(p_name, ''));
  v_description text := COALESCE(p_description, '');
  v_category text := btrim(COALESCE(p_category, ''));
  v_image_url text := NULLIF(btrim(COALESCE(p_image_url, '')), '');
  v_is_featured boolean := COALESCE(p_is_featured, false);
  v_display_order integer := COALESCE(p_display_order, 0);
  v_row public.products;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE = 'ADM01'; END IF;
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = 'ADM03'; END IF;
  IF p_request_id IS NULL THEN RAISE EXCEPTION 'invalid_request' USING ERRCODE = 'ADM22'; END IF;

  IF v_name = '' OR length(v_name) > 160 THEN RAISE EXCEPTION 'invalid_name' USING ERRCODE = 'ADM22'; END IF;
  IF v_category = '' OR length(v_category) > 80 THEN RAISE EXCEPTION 'invalid_category' USING ERRCODE = 'ADM22'; END IF;
  IF lower(v_category) = ANY (ARRAY['test', 'prueba']) THEN RAISE EXCEPTION 'reserved_category' USING ERRCODE = 'ADM22'; END IF;
  IF p_price IS NULL OR p_price <= 0 OR p_price > 100000000 THEN RAISE EXCEPTION 'invalid_price' USING ERRCODE = 'ADM22'; END IF;
  IF length(v_description) > 4000 THEN RAISE EXCEPTION 'invalid_description' USING ERRCODE = 'ADM22'; END IF;
  IF v_image_url IS NOT NULL AND v_image_url !~ '^https://' THEN RAISE EXCEPTION 'invalid_image_url' USING ERRCODE = 'ADM22'; END IF;
  IF v_display_order < 0 OR v_display_order > 100000 THEN RAISE EXCEPTION 'invalid_display_order' USING ERRCODE = 'ADM22'; END IF;
  IF p_stock_on_hand IS NULL OR p_stock_on_hand < 0 THEN RAISE EXCEPTION 'invalid_stock_on_hand' USING ERRCODE = 'ADM22'; END IF;

  -- New products are always created inactive; activation is a separate,
  -- separately validated operation (admin_set_product_active).
  INSERT INTO public.products (
    name, description, category, price, image_url, is_featured, display_order, stock_on_hand, is_active
  ) VALUES (
    v_name, v_description, v_category, p_price, v_image_url, v_is_featured, v_display_order, p_stock_on_hand, false
  ) RETURNING * INTO v_row;

  INSERT INTO public.admin_audit_events (actor_id, action, entity_type, entity_id, request_id, before_state, after_state)
  VALUES (
    v_actor, 'product.created', 'product', v_row.id::text, p_request_id, NULL,
    jsonb_build_object(
      'name', v_row.name, 'description', v_row.description, 'category', v_row.category,
      'price', v_row.price, 'image_url', v_row.image_url, 'is_featured', v_row.is_featured,
      'display_order', v_row.display_order, 'stock_on_hand', v_row.stock_on_hand, 'is_active', v_row.is_active
    )
  );

  RETURN v_row;
EXCEPTION
  WHEN unique_violation THEN RAISE EXCEPTION 'duplicate_request' USING ERRCODE = 'ADM09';
END;
$$;

CREATE FUNCTION "public"."admin_update_product"(
  "p_product_id" uuid,
  "p_name" text,
  "p_description" text,
  "p_category" text,
  "p_price" numeric,
  "p_image_url" text,
  "p_is_featured" boolean,
  "p_display_order" integer,
  "p_stock_on_hand" integer,
  "p_expected_updated_at" timestamp with time zone,
  "p_request_id" uuid
) RETURNS "public"."products"
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_name text := btrim(COALESCE(p_name, ''));
  v_description text := COALESCE(p_description, '');
  v_category text := btrim(COALESCE(p_category, ''));
  v_image_url text := NULLIF(btrim(COALESCE(p_image_url, '')), '');
  v_is_featured boolean := COALESCE(p_is_featured, false);
  v_display_order integer := COALESCE(p_display_order, 0);
  v_before public.products;
  v_after public.products;
  v_price_changed boolean;
  v_changed boolean;
  v_action text;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE = 'ADM01'; END IF;
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = 'ADM03'; END IF;
  IF p_product_id IS NULL OR p_request_id IS NULL OR p_expected_updated_at IS NULL THEN
    RAISE EXCEPTION 'invalid_request' USING ERRCODE = 'ADM22';
  END IF;

  IF v_name = '' OR length(v_name) > 160 THEN RAISE EXCEPTION 'invalid_name' USING ERRCODE = 'ADM22'; END IF;
  IF v_category = '' OR length(v_category) > 80 THEN RAISE EXCEPTION 'invalid_category' USING ERRCODE = 'ADM22'; END IF;
  IF p_price IS NULL OR p_price <= 0 OR p_price > 100000000 THEN RAISE EXCEPTION 'invalid_price' USING ERRCODE = 'ADM22'; END IF;
  IF length(v_description) > 4000 THEN RAISE EXCEPTION 'invalid_description' USING ERRCODE = 'ADM22'; END IF;
  IF v_image_url IS NOT NULL AND v_image_url !~ '^https://' THEN RAISE EXCEPTION 'invalid_image_url' USING ERRCODE = 'ADM22'; END IF;
  IF v_display_order < 0 OR v_display_order > 100000 THEN RAISE EXCEPTION 'invalid_display_order' USING ERRCODE = 'ADM22'; END IF;
  IF p_stock_on_hand IS NULL OR p_stock_on_hand < 0 THEN RAISE EXCEPTION 'invalid_stock_on_hand' USING ERRCODE = 'ADM22'; END IF;

  SELECT * INTO v_before FROM public.products WHERE id = p_product_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found' USING ERRCODE = 'ADM04'; END IF;
  IF v_before.updated_at <> p_expected_updated_at THEN RAISE EXCEPTION 'version_conflict' USING ERRCODE = 'ADM09'; END IF;

  -- An active product cannot be renamed into a reserved test category; it
  -- would keep a test fixture publicly visible under a mutated category.
  -- Editing a product that is already inactive or already TEST is allowed.
  IF v_before.is_active AND lower(v_category) = ANY (ARRAY['test', 'prueba']) THEN
    RAISE EXCEPTION 'reserved_category' USING ERRCODE = 'ADM22';
  END IF;

  v_changed := v_before.name IS DISTINCT FROM v_name
    OR v_before.description IS DISTINCT FROM v_description
    OR v_before.category IS DISTINCT FROM v_category
    OR v_before.price IS DISTINCT FROM p_price
    OR v_before.image_url IS DISTINCT FROM v_image_url
    OR v_before.is_featured IS DISTINCT FROM v_is_featured
    OR v_before.display_order IS DISTINCT FROM v_display_order
    OR v_before.stock_on_hand IS DISTINCT FROM p_stock_on_hand;

  IF NOT v_changed THEN
    RETURN v_before;
  END IF;

  UPDATE public.products SET
    name = v_name,
    description = v_description,
    category = v_category,
    price = p_price,
    image_url = v_image_url,
    is_featured = v_is_featured,
    display_order = v_display_order,
    stock_on_hand = p_stock_on_hand
  WHERE id = p_product_id
  RETURNING * INTO v_after;

  v_price_changed := v_before.price IS DISTINCT FROM v_after.price;
  v_action := CASE WHEN v_price_changed THEN 'product.price_changed' ELSE 'product.updated' END;

  INSERT INTO public.admin_audit_events (actor_id, action, entity_type, entity_id, request_id, before_state, after_state)
  VALUES (
    v_actor, v_action, 'product', v_after.id::text, p_request_id,
    jsonb_build_object(
      'name', v_before.name, 'description', v_before.description, 'category', v_before.category,
      'price', v_before.price, 'image_url', v_before.image_url, 'is_featured', v_before.is_featured,
      'display_order', v_before.display_order, 'stock_on_hand', v_before.stock_on_hand
    ),
    jsonb_build_object(
      'name', v_after.name, 'description', v_after.description, 'category', v_after.category,
      'price', v_after.price, 'image_url', v_after.image_url, 'is_featured', v_after.is_featured,
      'display_order', v_after.display_order, 'stock_on_hand', v_after.stock_on_hand
    )
  );

  RETURN v_after;
EXCEPTION
  WHEN unique_violation THEN RAISE EXCEPTION 'duplicate_request' USING ERRCODE = 'ADM09';
END;
$$;

CREATE FUNCTION "public"."admin_create_product_with_media"(
  "p_name" text,
  "p_description" text,
  "p_category" text,
  "p_price" numeric,
  "p_is_featured" boolean,
  "p_display_order" integer,
  "p_stock_on_hand" integer,
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

  v_product := public.admin_create_product(p_name, p_description, p_category, p_price, NULL, p_is_featured, p_display_order, p_stock_on_hand, p_request_id);

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

CREATE FUNCTION "public"."admin_update_product_with_media"(
  "p_product_id" uuid,
  "p_name" text,
  "p_description" text,
  "p_category" text,
  "p_price" numeric,
  "p_is_featured" boolean,
  "p_display_order" integer,
  "p_stock_on_hand" integer,
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

  v_product := public.admin_update_product(p_product_id, p_name, p_description, p_category, p_price, v_current_image_url, p_is_featured, p_display_order, p_stock_on_hand, p_expected_updated_at, p_request_id);

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

-- Grants: identical to before (anon/service_role excluded, authenticated
-- only -- re-checked internally via is_admin()). DROP removed the previous
-- grants along with the old signatures, so these are re-stated, not changed.
REVOKE ALL ON FUNCTION "public"."admin_create_product"(text, text, text, numeric, text, boolean, integer, integer, uuid) FROM PUBLIC, "anon", "authenticated";
REVOKE ALL ON FUNCTION "public"."admin_update_product"(uuid, text, text, text, numeric, text, boolean, integer, integer, timestamptz, uuid) FROM PUBLIC, "anon", "authenticated";
REVOKE ALL ON FUNCTION "public"."admin_create_product_with_media"(text, text, text, numeric, boolean, integer, integer, boolean, jsonb, uuid) FROM PUBLIC, "anon", "authenticated";
REVOKE ALL ON FUNCTION "public"."admin_update_product_with_media"(uuid, text, text, text, numeric, boolean, integer, integer, boolean, jsonb, timestamptz, uuid) FROM PUBLIC, "anon", "authenticated";

GRANT EXECUTE ON FUNCTION "public"."admin_create_product"(text, text, text, numeric, text, boolean, integer, integer, uuid) TO "authenticated";
GRANT EXECUTE ON FUNCTION "public"."admin_update_product"(uuid, text, text, text, numeric, text, boolean, integer, integer, timestamptz, uuid) TO "authenticated";
GRANT EXECUTE ON FUNCTION "public"."admin_create_product_with_media"(text, text, text, numeric, boolean, integer, integer, boolean, jsonb, uuid) TO "authenticated";
GRANT EXECUTE ON FUNCTION "public"."admin_update_product_with_media"(uuid, text, text, text, numeric, boolean, integer, integer, boolean, jsonb, timestamptz, uuid) TO "authenticated";

COMMIT;
