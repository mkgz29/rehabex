-- Restores the image-only media finalizer and the original settings/media
-- attachment wrapper from ADMIN-01C.

BEGIN;

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
  IF v_row.status <> 'authorized' AND v_row.secure_url = p_secure_url THEN RETURN v_row; END IF;
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
  VALUES (v_actor, 'media.finalized', 'media_asset', v_result.id::text, p_request_id, jsonb_build_object('status', v_row.status), jsonb_build_object('status', v_result.status, 'format', v_result.format, 'bytes', v_result.bytes, 'width', v_result.width, 'height', v_result.height));
  RETURN v_result;
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
    v_final_value := jsonb_set(p_value, ARRAY[v_field], to_jsonb(v_asset.secure_url));
    v_final_value := jsonb_set(v_final_value, ARRAY['image_asset_id'], to_jsonb(p_image_asset_id::text));
  END IF;

  SELECT * INTO v_before FROM public.settings WHERE key = p_key;
  IF FOUND THEN v_old_asset_id := NULLIF(v_before.value->>'image_asset_id', '')::uuid; END IF;
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

REVOKE ALL ON FUNCTION "public"."admin_finalize_media_asset"(text, text, text, text, integer, integer, integer, uuid) FROM PUBLIC, "anon", "authenticated";
REVOKE ALL ON FUNCTION "public"."admin_upsert_settings_document_with_media"(text, jsonb, uuid, timestamptz, uuid) FROM PUBLIC, "anon", "authenticated";
GRANT EXECUTE ON FUNCTION "public"."admin_finalize_media_asset"(text, text, text, text, integer, integer, integer, uuid) TO "authenticated";
GRANT EXECUTE ON FUNCTION "public"."admin_upsert_settings_document_with_media"(text, jsonb, uuid, timestamptz, uuid) TO "authenticated";

COMMIT;
