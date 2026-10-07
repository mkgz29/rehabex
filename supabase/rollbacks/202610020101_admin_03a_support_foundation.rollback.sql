-- Manual rollback for ADMIN-03A support foundation.
--
-- Drops the support RPCs and public.support_requests entirely, including any
-- rows already logged. This is safe only because the table is brand new in
-- this migration and nothing else references it; unlike ADMIN-01C's rollback,
-- there is no "keep the data, drop the write path" concern here. Local use
-- only; never run against remote without the same explicit review a forward
-- migration gets.

BEGIN;

DROP FUNCTION IF EXISTS "public"."admin_get_support_request"(uuid);
DROP FUNCTION IF EXISTS "public"."admin_list_support_requests"(text);
DROP FUNCTION IF EXISTS "public"."admin_update_support_request_notes"(uuid, text, timestamptz, uuid);
DROP FUNCTION IF EXISTS "public"."admin_update_support_request_status"(uuid, text, timestamptz, uuid);
DROP FUNCTION IF EXISTS "public"."admin_create_support_request"(text, text, text, text, text, uuid, uuid);

DROP TABLE IF EXISTS "public"."support_requests";

COMMIT;
