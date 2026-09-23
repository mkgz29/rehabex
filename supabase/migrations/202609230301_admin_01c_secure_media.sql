BEGIN;

-- ADMIN-01C: signed, server-verified media uploads. The browser never talks
-- to the database about a file directly; it only ever carries an opaque
-- media_assets.id (mediaAssetId) that the server resolves to a canonical
-- secure_url. No client role can write media_assets directly; every write
-- happens inside a SECURITY DEFINER RPC that re-checks auth.uid() and
-- public.is_admin() itself, so the boundary holds even against a caller that
-- talks to PostgREST directly instead of the panel.

-- 0. admin_audit_events: one request can now produce more than one event ----

-- ADMIN-01B assumed one HTTP request produces exactly one audit row. Media
-- attachment breaks that assumption on purpose: creating a product with a
-- new image is one request that legitimately audits both product.created
-- and media.attached under the same request_id. Uniqueness moves to
-- (request_id, action), which still rejects an exact duplicate insert.
DROP INDEX IF EXISTS "public"."idx_admin_audit_events_request_id";
CREATE UNIQUE INDEX IF NOT EXISTS "idx_admin_audit_events_request_id_action" ON "public"."admin_audit_events" ("request_id", "action");

-- 1. media_assets ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "public"."media_assets" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "provider" text NOT NULL DEFAULT 'cloudinary',
  "public_id" text NOT NULL,
  "folder" text NOT NULL,
  "secure_url" text,
  "format" text,
  "mime_type" text,
  "bytes" integer,
  "width" integer,
  "height" integer,
  -- authorized: /sign issued a signature, no upload verified yet.
  -- pending: /finalize verified the Cloudinary result; not attached to any content yet.
  -- attached: currently referenced by a product or a settings document.
  -- orphan_candidate: was attached, then replaced; not deleted automatically (see docs).
  "status" text NOT NULL DEFAULT 'authorized',
  "created_by" uuid NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "attached_at" timestamptz,
  "replaced_at" timestamptz,
  CONSTRAINT "media_assets_provider_check" CHECK ("provider" = 'cloudinary'),
  CONSTRAINT "media_assets_status_check" CHECK ("status" IN ('authorized', 'pending', 'attached', 'orphan_candidate')),
  CONSTRAINT "media_assets_secure_url_https_check" CHECK ("secure_url" IS NULL OR "secure_url" ~ '^https://'),
  CONSTRAINT "media_assets_bytes_check" CHECK ("bytes" IS NULL OR ("bytes" > 0 AND "bytes" <= 8388608)),
  CONSTRAINT "media_assets_width_check" CHECK ("width" IS NULL OR ("width" >= 400 AND "width" <= 6000)),
  CONSTRAINT "media_assets_height_check" CHECK ("height" IS NULL OR ("height" >= 400 AND "height" <= 6000))
);

CREATE UNIQUE INDEX IF NOT EXISTS "idx_media_assets_public_id" ON "public"."media_assets" ("public_id");
CREATE INDEX IF NOT EXISTS "idx_media_assets_status" ON "public"."media_assets" ("status");
CREATE INDEX IF NOT EXISTS "idx_media_assets_created_by" ON "public"."media_assets" ("created_by");

ALTER TABLE ONLY "public"."media_assets" FORCE ROW LEVEL SECURITY;
ALTER TABLE "public"."media_assets" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."media_assets" OWNER TO "postgres";

DROP TRIGGER IF EXISTS "set_updated_at" ON "public"."media_assets";
CREATE TRIGGER "set_updated_at"
BEFORE UPDATE ON "public"."media_assets"
FOR EACH ROW
EXECUTE FUNCTION "public"."update_updated_at_column"();

-- No INSERT/UPDATE/DELETE policy exists for any client role. Every writer is
-- a SECURITY DEFINER RPC below, which runs as the table owner and is
-- therefore unaffected by RLS or by the absence of a client grant.
DROP POLICY IF EXISTS "admin read media assets" ON "public"."media_assets";
CREATE POLICY "admin read media assets"
ON "public"."media_assets"
FOR SELECT
TO "authenticated"
USING (public.is_admin());

REVOKE ALL ON TABLE "public"."media_assets" FROM PUBLIC, "anon", "authenticated", "service_role";
GRANT SELECT ON TABLE "public"."media_assets" TO "authenticated";

-- 2. Product/settings reference to a managed asset ---------------------------

ALTER TABLE "public"."products"
  ADD COLUMN IF NOT EXISTS "image_asset_id" uuid REFERENCES "public"."media_assets"("id");

CREATE INDEX IF NOT EXISTS "idx_products_image_asset_id" ON "public"."products" ("image_asset_id");

-- 3. Upload authorization and finalization RPCs ------------------------------

CREATE OR REPLACE FUNCTION "public"."admin_create_pending_media_asset"(
  "p_public_id" text,
  "p_folder" text,
  "p_request_id" uuid
) RETURNS "public"."media_assets"
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_row public.media_assets;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE = 'ADM01'; END IF;
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = 'ADM03'; END IF;
  IF p_public_id IS NULL OR btrim(p_public_id) = '' OR p_folder IS NULL OR btrim(p_folder) = '' OR p_request_id IS NULL THEN
    RAISE EXCEPTION 'invalid_request' USING ERRCODE = 'ADM22';
  END IF;

  INSERT INTO public.media_assets (provider, public_id, folder, status, created_by)
  VALUES ('cloudinary', p_public_id, p_folder, 'authorized', v_actor)
  RETURNING * INTO v_row;

  RETURN v_row;
EXCEPTION
  WHEN unique_violation THEN RAISE EXCEPTION 'duplicate_request' USING ERRCODE = 'ADM09';
END;
$$;

CREATE OR REPLACE FUNCTION "public"."admin_finalize_media_asset"(
  "p_public_id" text,
  "p_secure_url" text,
  "p_format" text,
  "p_mime_type" text,
  "p_bytes" integer,
  "p_width" integer,
  "p_height" integer,
  "p_request_id" uuid
) RETURNS "public"."media_assets"
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_row public.media_assets;
  v_result public.media_assets;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE = 'ADM01'; END IF;
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = 'ADM03'; END IF;
  IF p_public_id IS NULL OR p_secure_url IS NULL OR p_format IS NULL OR p_mime_type IS NULL
     OR p_bytes IS NULL OR p_width IS NULL OR p_height IS NULL OR p_request_id IS NULL THEN
    RAISE EXCEPTION 'invalid_request' USING ERRCODE = 'ADM22';
  END IF;
  IF p_secure_url !~ '^https://' THEN RAISE EXCEPTION 'invalid_secure_url' USING ERRCODE = 'ADM22'; END IF;
  IF lower(p_format) NOT IN ('jpg', 'jpeg', 'png', 'webp') THEN RAISE EXCEPTION 'invalid_format' USING ERRCODE = 'ADM22'; END IF;
  IF p_bytes <= 0 OR p_bytes > 8388608 THEN RAISE EXCEPTION 'invalid_bytes' USING ERRCODE = 'ADM22'; END IF;
  IF p_width < 400 OR p_height < 400 OR p_width > 6000 OR p_height > 6000 THEN
    RAISE EXCEPTION 'invalid_dimensions' USING ERRCODE = 'ADM22';
  END IF;

  SELECT * INTO v_row FROM public.media_assets WHERE public_id = p_public_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'authorization_not_found' USING ERRCODE = 'ADM04'; END IF;
  IF v_row.created_by <> v_actor THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = 'ADM03'; END IF;

  -- Idempotent retry of an already-finalized upload with the same result.
  IF v_row.status <> 'authorized' AND v_row.secure_url = p_secure_url THEN
    RETURN v_row;
  END IF;
  IF v_row.status <> 'authorized' THEN RAISE EXCEPTION 'asset_not_authorized' USING ERRCODE = 'ADM09'; END IF;
  IF v_row.created_at < now() - interval '5 minutes' THEN RAISE EXCEPTION 'authorization_expired' USING ERRCODE = 'ADM10'; END IF;

  UPDATE public.media_assets SET
    secure_url = p_secure_url,
    format = lower(p_format),
    mime_type = p_mime_type,
    bytes = p_bytes,
    width = p_width,
    height = p_height,
    status = 'pending'
  WHERE id = v_row.id
  RETURNING * INTO v_result;

  INSERT INTO public.admin_audit_events (actor_id, action, entity_type, entity_id, request_id, before_state, after_state)
  VALUES (
    v_actor, 'media.finalized', 'media_asset', v_result.id::text, p_request_id,
    jsonb_build_object('status', v_row.status),
    jsonb_build_object('status', v_result.status, 'format', v_result.format, 'bytes', v_result.bytes, 'width', v_result.width, 'height', v_result.height)
  );

  RETURN v_result;
END;
$$;

-- 4. Product/settings mutation wrappers that resolve and attach a media asset

CREATE OR REPLACE FUNCTION "public"."admin_create_product_with_media"(
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

CREATE OR REPLACE FUNCTION "public"."admin_update_product_with_media"(
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

CREATE OR REPLACE FUNCTION "public"."admin_upsert_settings_document_with_media"(
  "p_key" text,
  "p_value" jsonb,
  "p_image_asset_id" uuid,
  "p_expected_updated_at" timestamptz,
  "p_request_id" uuid
) RETURNS "public"."settings"
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_field text;
  v_asset public.media_assets;
  v_before public.settings;
  v_old_asset_id uuid;
  v_final_value jsonb := p_value;
  v_result public.settings;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE = 'ADM01'; END IF;
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = 'ADM03'; END IF;
  IF p_key NOT IN ('hero_content', 'about_content') THEN RAISE EXCEPTION 'invalid_key' USING ERRCODE = 'ADM22'; END IF;
  v_field := CASE WHEN p_key = 'hero_content' THEN 'image_url' ELSE 'image' END;

  IF p_image_asset_id IS NOT NULL THEN
    SELECT * INTO v_asset FROM public.media_assets WHERE id = p_image_asset_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'asset_not_found' USING ERRCODE = 'ADM04'; END IF;
    IF v_asset.created_by <> v_actor THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = 'ADM03'; END IF;
    IF v_asset.status <> 'pending' THEN RAISE EXCEPTION 'asset_not_available' USING ERRCODE = 'ADM22'; END IF;
    -- The server derives the persisted URL; the client-supplied value for
    -- this field is never trusted even if present.
    v_final_value := jsonb_set(p_value, ARRAY[v_field], to_jsonb(v_asset.secure_url));
    v_final_value := jsonb_set(v_final_value, ARRAY['image_asset_id'], to_jsonb(p_image_asset_id::text));
  END IF;

  SELECT * INTO v_before FROM public.settings WHERE key = p_key;
  IF FOUND THEN
    v_old_asset_id := NULLIF(v_before.value->>'image_asset_id', '')::uuid;
  END IF;

  v_result := public.admin_upsert_settings_document(p_key, v_final_value, p_expected_updated_at, p_request_id);

  IF p_image_asset_id IS NOT NULL AND p_image_asset_id IS DISTINCT FROM v_old_asset_id THEN
    UPDATE public.media_assets SET status = 'attached', attached_at = now() WHERE id = p_image_asset_id;

    INSERT INTO public.admin_audit_events (actor_id, action, entity_type, entity_id, request_id, before_state, after_state)
    VALUES (v_actor, 'media.attached', 'media_asset', p_image_asset_id::text, p_request_id, NULL, jsonb_build_object('entity_type', 'settings', 'entity_id', p_key));

    IF v_old_asset_id IS NOT NULL THEN
      UPDATE public.media_assets SET status = 'orphan_candidate', replaced_at = now() WHERE id = v_old_asset_id AND status = 'attached';

      INSERT INTO public.admin_audit_events (actor_id, action, entity_type, entity_id, request_id, before_state, after_state)
      VALUES (v_actor, 'media.orphaned', 'media_asset', v_old_asset_id::text, p_request_id, jsonb_build_object('status', 'attached'), jsonb_build_object('status', 'orphan_candidate', 'replaced_by', p_image_asset_id::text));
    END IF;
  END IF;

  RETURN v_result;
END;
$$;

-- 5. Grants: authenticated may call these RPCs, which validate admin
--    internally; no other client role may call them at all. --------------

REVOKE ALL ON FUNCTION "public"."admin_create_pending_media_asset"(text, text, uuid) FROM PUBLIC, "anon", "authenticated";
REVOKE ALL ON FUNCTION "public"."admin_finalize_media_asset"(text, text, text, text, integer, integer, integer, uuid) FROM PUBLIC, "anon", "authenticated";
REVOKE ALL ON FUNCTION "public"."admin_create_product_with_media"(text, text, text, numeric, text, uuid, boolean, integer, uuid) FROM PUBLIC, "anon", "authenticated";
REVOKE ALL ON FUNCTION "public"."admin_update_product_with_media"(uuid, text, text, text, numeric, text, uuid, boolean, integer, timestamptz, uuid) FROM PUBLIC, "anon", "authenticated";
REVOKE ALL ON FUNCTION "public"."admin_upsert_settings_document_with_media"(text, jsonb, uuid, timestamptz, uuid) FROM PUBLIC, "anon", "authenticated";

GRANT EXECUTE ON FUNCTION "public"."admin_create_pending_media_asset"(text, text, uuid) TO "authenticated";
GRANT EXECUTE ON FUNCTION "public"."admin_finalize_media_asset"(text, text, text, text, integer, integer, integer, uuid) TO "authenticated";
GRANT EXECUTE ON FUNCTION "public"."admin_create_product_with_media"(text, text, text, numeric, text, uuid, boolean, integer, uuid) TO "authenticated";
GRANT EXECUTE ON FUNCTION "public"."admin_update_product_with_media"(uuid, text, text, text, numeric, text, uuid, boolean, integer, timestamptz, uuid) TO "authenticated";
GRANT EXECUTE ON FUNCTION "public"."admin_upsert_settings_document_with_media"(text, jsonb, uuid, timestamptz, uuid) TO "authenticated";

COMMIT;
