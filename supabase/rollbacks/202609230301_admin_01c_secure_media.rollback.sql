-- Manual rollback for ADMIN-01C secure media.
--
-- Drops the media RPCs and the products.image_asset_id reference, and
-- returns products/settings mutations to the ADMIN-01B RPCs only. Does NOT
-- drop public.media_assets or any row inside it: rolling back the write path
-- must never erase already-registered media history. Local use only; never
-- run against remote. Any Cloudinary assets already uploaded remain in the
-- Cloudinary account regardless of this rollback (this migration never
-- deletes provider-side files).

BEGIN;

DROP INDEX IF EXISTS "public"."idx_admin_audit_events_request_id_action";
CREATE UNIQUE INDEX IF NOT EXISTS "idx_admin_audit_events_request_id" ON "public"."admin_audit_events" ("request_id");

DROP FUNCTION IF EXISTS "public"."admin_upsert_settings_document_with_media"(text, jsonb, uuid, timestamptz, uuid);
DROP FUNCTION IF EXISTS "public"."admin_update_product_with_media"(uuid, text, text, text, numeric, text, uuid, boolean, integer, timestamptz, uuid);
DROP FUNCTION IF EXISTS "public"."admin_create_product_with_media"(text, text, text, numeric, text, uuid, boolean, integer, uuid);
DROP FUNCTION IF EXISTS "public"."admin_finalize_media_asset"(text, text, text, text, integer, integer, integer, uuid);
DROP FUNCTION IF EXISTS "public"."admin_create_pending_media_asset"(text, text, uuid);

ALTER TABLE "public"."products" DROP COLUMN IF EXISTS "image_asset_id";

-- public.media_assets, its RLS policy, its grant and any row inside it are
-- intentionally left in place.

COMMIT;
