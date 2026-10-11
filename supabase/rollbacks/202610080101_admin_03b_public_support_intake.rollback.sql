-- Manual rollback for ADMIN-03B public support intake.
--
-- Drops everything 03B added and reverts support_requests to its 03A shape.
-- The ALTER COLUMN created_by SET NOT NULL step only succeeds if no web
-- (created_by IS NULL) rows exist yet -- true for a fresh local test cycle,
-- not guaranteed once real traffic has landed. Local use only; never run
-- against remote without the same explicit review a forward migration gets.

BEGIN;

REVOKE ALL ON FUNCTION "public"."public_create_support_request"(text, text, text, text, text, text, text, uuid, text) FROM "anon";
DROP FUNCTION IF EXISTS "public"."public_create_support_request"(text, text, text, text, text, text, text, uuid, text);

DROP FUNCTION IF EXISTS "public"."purge_support_intake_rate_limit_windows"();
DROP FUNCTION IF EXISTS "public"."consume_support_intake_rate_limit"(text);

DROP TABLE IF EXISTS "public"."support_intake_rate_limit_windows";

ALTER TABLE "public"."support_requests" DROP CONSTRAINT IF EXISTS "support_requests_topic_check";
ALTER TABLE "public"."support_requests" DROP COLUMN IF EXISTS "topic";

ALTER TABLE "public"."support_requests" DROP CONSTRAINT IF EXISTS "support_requests_source_check";
ALTER TABLE "public"."support_requests" DROP COLUMN IF EXISTS "source";

ALTER TABLE "public"."support_requests" DROP CONSTRAINT IF EXISTS "support_requests_order_reference_length_check";
ALTER TABLE "public"."support_requests" DROP COLUMN IF EXISTS "order_reference";

ALTER TABLE "public"."support_requests" ALTER COLUMN "created_by" SET NOT NULL;

COMMIT;
