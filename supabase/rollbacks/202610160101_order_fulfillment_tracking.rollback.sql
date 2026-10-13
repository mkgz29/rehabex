-- Manual rollback for FASE 7F-B4 order fulfillment tracking.
--
-- Drops the RPC, the tracking_token_hash column/index, and the
-- order_fulfillment_events table entirely, including any history already
-- logged. Does NOT touch orders.fulfillment_status itself (pre-existing
-- column/enum from 202609110103) or any payment-related column/RPC.
--
-- If any order already has fulfillment_status moved away from
-- 'not_started' by the time this runs, that value stays on the order (it is
-- a pre-existing column, untouched here) -- only the new history/RPC/token
-- machinery is removed, so an order already marked 'preparing' simply keeps
-- reading as 'preparing' with no history behind it. Local use only; never
-- run against remote without the same explicit review a forward migration
-- gets.

BEGIN;

DROP FUNCTION IF EXISTS "public"."admin_update_order_fulfillment_status"(uuid, text, text, uuid);

DROP INDEX IF EXISTS "public"."idx_orders_tracking_token_hash_unique";
ALTER TABLE "public"."orders" DROP COLUMN IF EXISTS "tracking_token_hash";

DROP TABLE IF EXISTS "public"."order_fulfillment_events";

COMMIT;
