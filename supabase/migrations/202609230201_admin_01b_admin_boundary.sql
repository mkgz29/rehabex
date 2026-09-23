BEGIN;

-- ADMIN-01B: narrow, audited, transactional operations replace direct
-- browser writes to products/settings. RLS keeps read access unchanged;
-- only the mutation surface moves behind SECURITY DEFINER RPCs that verify
-- auth.uid() and public.is_admin() themselves, so the boundary holds even if
-- a caller bypasses the panel and talks to PostgREST directly.

-- 1. Append-only administrative audit trail ---------------------------------

CREATE TABLE IF NOT EXISTS "public"."admin_audit_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "actor_id" uuid NOT NULL,
  "action" text NOT NULL,
  "entity_type" text NOT NULL,
  "entity_id" text,
  "request_id" uuid NOT NULL,
  "before_state" jsonb,
  "after_state" jsonb,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "idx_admin_audit_events_request_id" ON "public"."admin_audit_events" ("request_id");
CREATE INDEX IF NOT EXISTS "idx_admin_audit_events_entity" ON "public"."admin_audit_events" ("entity_type", "entity_id");
CREATE INDEX IF NOT EXISTS "idx_admin_audit_events_created_at" ON "public"."admin_audit_events" ("created_at" DESC);

ALTER TABLE ONLY "public"."admin_audit_events" FORCE ROW LEVEL SECURITY;
ALTER TABLE "public"."admin_audit_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."admin_audit_events" OWNER TO "postgres";

-- No INSERT/UPDATE/DELETE policy exists for any client role. The only writer
-- is the SECURITY DEFINER RPC below, which runs as the table owner and is
-- therefore unaffected by RLS or by the absence of a client grant.
CREATE POLICY "admin read audit events"
ON "public"."admin_audit_events"
FOR SELECT
TO "authenticated"
USING (public.is_admin());

REVOKE ALL ON TABLE "public"."admin_audit_events" FROM PUBLIC, "anon", "authenticated", "service_role";
GRANT SELECT ON TABLE "public"."admin_audit_events" TO "authenticated";

-- 2. Revoke direct client writes on products/settings/product_images -------

REVOKE INSERT, UPDATE, DELETE ON TABLE "public"."products" FROM "authenticated";
REVOKE INSERT, UPDATE, DELETE ON TABLE "public"."settings" FROM "authenticated";
REVOKE INSERT, UPDATE, DELETE ON TABLE "public"."product_images" FROM "authenticated";

DROP POLICY IF EXISTS "admin insert products" ON "public"."products";
DROP POLICY IF EXISTS "admin update products" ON "public"."products";
DROP POLICY IF EXISTS "admin delete products" ON "public"."products";
DROP POLICY IF EXISTS "admin insert settings" ON "public"."settings";
DROP POLICY IF EXISTS "admin update settings" ON "public"."settings";
DROP POLICY IF EXISTS "admin delete settings" ON "public"."settings";
DROP POLICY IF EXISTS "admin insert product images" ON "public"."product_images";
DROP POLICY IF EXISTS "admin update product images" ON "public"."product_images";
DROP POLICY IF EXISTS "admin delete product images" ON "public"."product_images";

-- Read policies (public + admin read-all) are untouched by ADMIN-01B.

-- 3. Reliable updated_at on settings, for optimistic concurrency -----------

DROP TRIGGER IF EXISTS "set_updated_at" ON "public"."settings";
CREATE TRIGGER "set_updated_at"
BEFORE UPDATE ON "public"."settings"
FOR EACH ROW
EXECUTE FUNCTION "public"."update_updated_at_column"();

-- 4. Narrow administrative RPCs ---------------------------------------------

CREATE OR REPLACE FUNCTION "public"."admin_create_product"(
  "p_name" text,
  "p_description" text,
  "p_category" text,
  "p_price" numeric,
  "p_image_url" text,
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

  -- New products are always created inactive; activation is a separate,
  -- separately validated operation (admin_set_product_active).
  INSERT INTO public.products (
    name, description, category, price, image_url, is_featured, display_order, is_active
  ) VALUES (
    v_name, v_description, v_category, p_price, v_image_url, v_is_featured, v_display_order, false
  ) RETURNING * INTO v_row;

  INSERT INTO public.admin_audit_events (actor_id, action, entity_type, entity_id, request_id, before_state, after_state)
  VALUES (
    v_actor, 'product.created', 'product', v_row.id::text, p_request_id, NULL,
    jsonb_build_object(
      'name', v_row.name, 'description', v_row.description, 'category', v_row.category,
      'price', v_row.price, 'image_url', v_row.image_url, 'is_featured', v_row.is_featured,
      'display_order', v_row.display_order, 'is_active', v_row.is_active
    )
  );

  RETURN v_row;
EXCEPTION
  WHEN unique_violation THEN RAISE EXCEPTION 'duplicate_request' USING ERRCODE = 'ADM09';
END;
$$;

CREATE OR REPLACE FUNCTION "public"."admin_update_product"(
  "p_product_id" uuid,
  "p_name" text,
  "p_description" text,
  "p_category" text,
  "p_price" numeric,
  "p_image_url" text,
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
    OR v_before.display_order IS DISTINCT FROM v_display_order;

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
    display_order = v_display_order
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
      'display_order', v_before.display_order
    ),
    jsonb_build_object(
      'name', v_after.name, 'description', v_after.description, 'category', v_after.category,
      'price', v_after.price, 'image_url', v_after.image_url, 'is_featured', v_after.is_featured,
      'display_order', v_after.display_order
    )
  );

  RETURN v_after;
EXCEPTION
  WHEN unique_violation THEN RAISE EXCEPTION 'duplicate_request' USING ERRCODE = 'ADM09';
END;
$$;

CREATE OR REPLACE FUNCTION "public"."admin_set_product_active"(
  "p_product_id" uuid,
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
  v_before public.products;
  v_after public.products;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE = 'ADM01'; END IF;
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = 'ADM03'; END IF;
  IF p_product_id IS NULL OR p_request_id IS NULL OR p_expected_updated_at IS NULL OR p_is_active IS NULL THEN
    RAISE EXCEPTION 'invalid_request' USING ERRCODE = 'ADM22';
  END IF;

  SELECT * INTO v_before FROM public.products WHERE id = p_product_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found' USING ERRCODE = 'ADM04'; END IF;
  IF v_before.updated_at <> p_expected_updated_at THEN RAISE EXCEPTION 'version_conflict' USING ERRCODE = 'ADM09'; END IF;

  IF p_is_active THEN
    IF v_before.name IS NULL OR btrim(v_before.name) = '' THEN RAISE EXCEPTION 'invalid_name' USING ERRCODE = 'ADM22'; END IF;
    IF v_before.price IS NULL OR v_before.price <= 0 THEN RAISE EXCEPTION 'invalid_price' USING ERRCODE = 'ADM22'; END IF;
    IF v_before.category IS NULL OR btrim(v_before.category) = '' THEN RAISE EXCEPTION 'invalid_category' USING ERRCODE = 'ADM22'; END IF;
    IF lower(btrim(v_before.category)) = ANY (ARRAY['test', 'prueba']) THEN RAISE EXCEPTION 'reserved_category' USING ERRCODE = 'ADM22'; END IF;
  END IF;

  IF v_before.is_active = p_is_active THEN
    RETURN v_before;
  END IF;

  UPDATE public.products SET is_active = p_is_active WHERE id = p_product_id RETURNING * INTO v_after;

  INSERT INTO public.admin_audit_events (actor_id, action, entity_type, entity_id, request_id, before_state, after_state)
  VALUES (
    v_actor,
    CASE WHEN p_is_active THEN 'product.activated' ELSE 'product.deactivated' END,
    'product', v_after.id::text, p_request_id,
    jsonb_build_object('is_active', v_before.is_active),
    jsonb_build_object('is_active', v_after.is_active)
  );

  RETURN v_after;
EXCEPTION
  WHEN unique_violation THEN RAISE EXCEPTION 'duplicate_request' USING ERRCODE = 'ADM09';
END;
$$;

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
  -- Fixed allowlist: the client never chooses an arbitrary settings key.
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

-- 5. Grants: authenticated may call these RPCs, which validate admin
--    membership internally; no other client role may call them at all. -----

REVOKE ALL ON FUNCTION "public"."admin_create_product"(text, text, text, numeric, text, boolean, integer, uuid) FROM PUBLIC, "anon", "authenticated";
REVOKE ALL ON FUNCTION "public"."admin_update_product"(uuid, text, text, text, numeric, text, boolean, integer, timestamptz, uuid) FROM PUBLIC, "anon", "authenticated";
REVOKE ALL ON FUNCTION "public"."admin_set_product_active"(uuid, boolean, timestamptz, uuid) FROM PUBLIC, "anon", "authenticated";
REVOKE ALL ON FUNCTION "public"."admin_upsert_settings_document"(text, jsonb, timestamptz, uuid) FROM PUBLIC, "anon", "authenticated";

GRANT EXECUTE ON FUNCTION "public"."admin_create_product"(text, text, text, numeric, text, boolean, integer, uuid) TO "authenticated";
GRANT EXECUTE ON FUNCTION "public"."admin_update_product"(uuid, text, text, text, numeric, text, boolean, integer, timestamptz, uuid) TO "authenticated";
GRANT EXECUTE ON FUNCTION "public"."admin_set_product_active"(uuid, boolean, timestamptz, uuid) TO "authenticated";
GRANT EXECUTE ON FUNCTION "public"."admin_upsert_settings_document"(text, jsonb, timestamptz, uuid) TO "authenticated";

COMMIT;
