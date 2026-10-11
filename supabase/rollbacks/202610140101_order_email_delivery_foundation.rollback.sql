-- Manual rollback for FASE 7E-B1 order email delivery foundation.
--
-- Drops the claim/mark RPCs and public.order_email_events entirely, including
-- any rows already logged. Safe because: (1) the table is brand new in this
-- migration and nothing else references it (no FK points at it), and (2) no
-- part of this phase wires an actual send into the payment confirmation path
-- yet, so there is no in-flight production traffic depending on this table.
-- Local use only; never run against remote without the same explicit review
-- a forward migration gets.

BEGIN;

DROP FUNCTION IF EXISTS "public"."mark_order_email_failed"(uuid, text, text);
DROP FUNCTION IF EXISTS "public"."mark_order_email_sent"(uuid, text, text);
DROP FUNCTION IF EXISTS "public"."claim_order_email_delivery"(uuid, text);

DROP TABLE IF EXISTS "public"."order_email_events";

COMMIT;
