BEGIN;

-- FASE CMS: Hero carousel + editable eyebrow text.
--
-- The eyebrow ("Rehabilitacion . Movilidad . Bienestar") needs no schema
-- change at all: hero_content.value is already a free-form jsonb document
-- (see 202609230201's admin_upsert_settings_document), so adding an
-- "eyebrow" key to it is purely an application-layer change (validators,
-- normalizeHeroContent, HeroSection, AdminHeroPage) -- nothing here writes
-- to hero_content directly except the one-time backfill below, which keeps
-- today's hardcoded copy as the persisted value so nothing visibly changes
-- the moment this ships.
--
-- The carousel is a different story: it needs an ordered, independently
-- addressable *set* of images, each with its own Cloudinary asset
-- claim/orphan lifecycle -- exactly what product_images +
-- admin_sync_product_gallery already solve for products. Reusing that
-- lifecycle correctly on a jsonb array inside settings.value would mean
-- re-deriving ownership/orphan safety with ad hoc jsonb_set calls and no
-- real constraints; a small table mirroring product_images (minus the
-- product_id FK, since the hero has no owning row to hang off of) is the
-- "realmente necesario" case for a new table, not a default reach for one.

-- 1. hero_images: an ordered, independently-editable image set, exactly the
-- product_images shape minus product_id and is_primary (every enabled row
-- is a carousel slide; there is no "primary" concept here).
CREATE TABLE IF NOT EXISTS "public"."hero_images" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "media_asset_id" uuid REFERENCES "public"."media_assets"("id") ON DELETE SET NULL,
  "url" text NOT NULL,
  "alt_text" text,
  "display_order" integer NOT NULL DEFAULT 0,
  "enabled" boolean NOT NULL DEFAULT true,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "hero_images_url_not_empty_check" CHECK (btrim("url") <> '')
);

CREATE UNIQUE INDEX IF NOT EXISTS "idx_hero_images_order_unique" ON "public"."hero_images" ("display_order");
CREATE UNIQUE INDEX IF NOT EXISTS "idx_hero_images_asset_unique" ON "public"."hero_images" ("media_asset_id") WHERE "media_asset_id" IS NOT NULL;

ALTER TABLE ONLY "public"."hero_images" FORCE ROW LEVEL SECURITY;
ALTER TABLE "public"."hero_images" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."hero_images" OWNER TO "postgres";

-- Public only ever sees enabled slides. Admin (authenticated + is_admin())
-- sees every row -- disabled slides must stay visible and manageable in the
-- editor. Two separate policies, not one combined "anon, authenticated"
-- policy with an OR is_admin() -- is_admin() is never granted EXECUTE to
-- "anon" anywhere in this codebase (every other anon-facing policy, e.g.
-- products', avoids calling it at all), exactly the same shape
-- products/product_images already use.
DROP POLICY IF EXISTS "public read enabled hero images" ON "public"."hero_images";
CREATE POLICY "public read enabled hero images"
ON "public"."hero_images"
FOR SELECT
TO "anon"
USING ("enabled" = true);

DROP POLICY IF EXISTS "authenticated read hero images" ON "public"."hero_images";
CREATE POLICY "authenticated read hero images"
ON "public"."hero_images"
FOR SELECT
TO "authenticated"
USING ("enabled" = true OR public.is_admin());

REVOKE ALL ON TABLE "public"."hero_images" FROM PUBLIC, "anon";
GRANT SELECT ON TABLE "public"."hero_images" TO "anon";
GRANT SELECT ON TABLE "public"."hero_images" TO "authenticated";
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "public"."hero_images" TO "service_role";
-- No INSERT/UPDATE/DELETE grant to authenticated: the only writer is
-- admin_sync_hero_images below (SECURITY DEFINER, runs as the table owner).

-- 2. One-time backfill: carry the current single hero image over as slide 0,
-- exactly like product_images' own legacy backfill. Guarded by "table is
-- still empty" so this never runs twice and never duplicates a slide if the
-- migration is ever re-applied in a fresh environment that already has rows.
INSERT INTO "public"."hero_images" ("media_asset_id", "url", "display_order", "enabled")
SELECT
  NULLIF(s.value->>'image_asset_id', '')::uuid,
  s.value->>'image_url',
  0,
  true
FROM "public"."settings" s
WHERE s.key = 'hero_content'
  AND COALESCE(s.value->>'image_url', '') <> ''
  AND NOT EXISTS (SELECT 1 FROM "public"."hero_images");

-- Same backfill idea for the eyebrow: persist today's hardcoded copy as the
-- real CMS value, only when hero_content doesn't already carry one (so a
-- re-run, or an admin who already saved a custom eyebrow, is never
-- clobbered).
UPDATE "public"."settings"
SET value = jsonb_set(value, ARRAY['eyebrow'], to_jsonb('Rehabilitación · Movilidad · Bienestar'::text))
WHERE key = 'hero_content' AND COALESCE(value->>'eyebrow', '') = '';

-- 3. admin_sync_hero_images: whole-set replace, modeled closely on
-- admin_sync_product_gallery (same validate-then-replace-then-orphan shape),
-- with two differences: no product_id (the hero has exactly one, implicit,
-- gallery) and no "exactly one primary" rule -- "enabled" is a plain
-- per-slide boolean the admin may set however they like; the UI warns below
-- 3 enabled images but this RPC never blocks a save over it (see FASE spec:
-- "NO bloquear al cliente innecesariamente").
CREATE OR REPLACE FUNCTION "public"."admin_sync_hero_images"(
  "p_images" jsonb,
  "p_request_id" uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_count integer;
  v_item jsonb;
  v_asset_id uuid;
  v_legacy_url text;
  v_is_legacy boolean;
  v_alt text;
  v_enabled boolean;
  v_order integer;
  v_seen_ids uuid[] := ARRAY[]::uuid[];
  v_seen_urls text[] := ARRAY[]::text[];
  v_asset public.media_assets;
  v_secure_url text;
  v_old_ids uuid[];
  v_removed_id uuid;
  v_before jsonb;
  v_after jsonb;
  v_result jsonb;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE = 'ADM01'; END IF;
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = 'ADM03'; END IF;
  IF p_request_id IS NULL OR jsonb_typeof(p_images) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'invalid_gallery' USING ERRCODE = 'ADM22';
  END IF;

  v_count := jsonb_array_length(p_images);
  IF v_count > 8 THEN RAISE EXCEPTION 'too_many_images' USING ERRCODE = 'ADM22'; END IF;

  SELECT jsonb_agg(jsonb_build_object('mediaAssetId', media_asset_id, 'enabled', enabled) ORDER BY display_order)
    INTO v_before
  FROM public.hero_images;
  v_before := COALESCE(v_before, '[]'::jsonb);

  SELECT array_agg(media_asset_id) INTO v_old_ids FROM public.hero_images;

  -- Pass 1: validate every entry before writing anything (same two-pass
  -- shape as admin_sync_product_gallery, for the same reason: never leave
  -- hero_images partially replaced if a later entry turns out invalid).
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_images)
  LOOP
    IF jsonb_typeof(v_item) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'invalid_gallery' USING ERRCODE = 'ADM22'; END IF;

    v_asset_id := NULLIF(v_item->>'mediaAssetId', '')::uuid;
    v_legacy_url := NULLIF(v_item->>'legacyUrl', '');
    v_is_legacy := v_legacy_url IS NOT NULL;
    IF (v_asset_id IS NULL) = (v_legacy_url IS NULL) THEN
      RAISE EXCEPTION 'invalid_gallery' USING ERRCODE = 'ADM22';
    END IF;

    IF jsonb_typeof(v_item->'enabled') IS DISTINCT FROM 'boolean' THEN
      RAISE EXCEPTION 'invalid_gallery' USING ERRCODE = 'ADM22';
    END IF;

    IF v_is_legacy THEN
      IF v_legacy_url = ANY(v_seen_urls) THEN RAISE EXCEPTION 'duplicate_image' USING ERRCODE = 'ADM22'; END IF;
      v_seen_urls := array_append(v_seen_urls, v_legacy_url);

      IF NOT EXISTS (
        SELECT 1 FROM public.hero_images
        WHERE media_asset_id IS NULL AND url = v_legacy_url
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
      -- An asset already attached to a product (or vice versa -- the
      -- product RPC has the mirror check) can never be double-claimed here.
      IF EXISTS (SELECT 1 FROM public.product_images WHERE media_asset_id = v_asset_id) THEN
        RAISE EXCEPTION 'asset_already_used' USING ERRCODE = 'ADM22';
      END IF;
    END IF;
  END LOOP;

  -- Pass 2: replace the whole set. At most 8 rows, so a full delete+insert
  -- is cheap and avoids the same transient unique-index collisions a
  -- partial reorder would hit mid-transaction (idx_hero_images_order_unique).
  DELETE FROM public.hero_images;

  v_order := 0;
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_images)
  LOOP
    v_asset_id := NULLIF(v_item->>'mediaAssetId', '')::uuid;
    v_legacy_url := NULLIF(v_item->>'legacyUrl', '');
    v_alt := NULLIF(btrim(COALESCE(v_item->>'alt', '')), '');
    v_enabled := (v_item->>'enabled')::boolean;

    IF v_asset_id IS NOT NULL THEN
      SELECT secure_url INTO v_secure_url FROM public.media_assets WHERE id = v_asset_id;
      INSERT INTO public.hero_images (media_asset_id, url, alt_text, display_order, enabled)
      VALUES (v_asset_id, v_secure_url, v_alt, v_order, v_enabled);

      UPDATE public.media_assets SET status = 'attached', attached_at = now()
      WHERE id = v_asset_id AND status <> 'attached';
    ELSE
      INSERT INTO public.hero_images (media_asset_id, url, alt_text, display_order, enabled)
      VALUES (NULL, v_legacy_url, v_alt, v_order, v_enabled);
    END IF;

    v_order := v_order + 1;
  END LOOP;

  -- Anything that was in the old set and is not in the new one has nowhere
  -- else it could still be attached (the already-used check above is the
  -- only other claimant) -- always safe to mark it a cleanup candidate.
  IF v_old_ids IS NOT NULL THEN
    FOREACH v_removed_id IN ARRAY v_old_ids LOOP
      IF v_removed_id IS NOT NULL AND NOT (v_removed_id = ANY(v_seen_ids)) THEN
        UPDATE public.media_assets SET status = 'orphan_candidate', replaced_at = now()
        WHERE id = v_removed_id AND status = 'attached';
      END IF;
    END LOOP;
  END IF;

  SELECT jsonb_agg(jsonb_build_object('id', id, 'mediaAssetId', media_asset_id, 'url', url, 'alt', alt_text, 'enabled', enabled) ORDER BY display_order)
    INTO v_result
  FROM public.hero_images;
  v_result := COALESCE(v_result, '[]'::jsonb);

  SELECT jsonb_agg(jsonb_build_object('mediaAssetId', media_asset_id, 'enabled', enabled) ORDER BY display_order)
    INTO v_after
  FROM public.hero_images;
  v_after := COALESCE(v_after, '[]'::jsonb);

  IF v_before IS DISTINCT FROM v_after THEN
    INSERT INTO public.admin_audit_events (actor_id, action, entity_type, entity_id, request_id, before_state, after_state)
    VALUES (v_actor, 'hero.images_updated', 'settings', 'hero_content', p_request_id, jsonb_build_object('images', v_before), jsonb_build_object('images', v_after));
  END IF;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION "public"."admin_sync_hero_images"(jsonb, uuid) FROM PUBLIC, "anon", "authenticated";
GRANT EXECUTE ON FUNCTION "public"."admin_sync_hero_images"(jsonb, uuid) TO "authenticated";

COMMIT;
