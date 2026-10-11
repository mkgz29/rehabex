BEGIN;

-- FASE 7E-B1: foundation for transactional purchase emails. This migration
-- only creates the idempotency/claim state; nothing in this phase sends an
-- email or touches the payment confirmation path.
--
-- One canonical row per (order_id, email_type), not an append-only log like
-- payment_events: an email either hasn't been attempted, is being attempted
-- right now, or has a final outcome. There is no "pending" state distinct
-- from "processing" -- the claim RPC both creates the row and reserves the
-- right to send in the same atomic step, so no row is ever observed without
-- an active or completed attempt behind it. Three states are therefore
-- sufficient and simpler to reason about than payment_events' multi-row model:
--
--   processing -- an attempt is in flight (or, past a short staleness
--                 window, was abandoned by a crashed/timed-out process and
--                 may be reclaimed).
--   sent       -- terminal. Never re-claimable automatically.
--   failed     -- terminal for that attempt, but retryable: a later claim
--                 may reclaim it and move it back to processing.
--
-- Service-role only, same boundary as payment_events: this table is never
-- read or written through a user session (there is no "customer" or "admin"
-- actor here, only backend code reacting to a payment confirmation), so RLS
-- is enabled+forced with zero policies and every grant goes to service_role
-- alone -- anon/authenticated can reach precisely nothing on this table or
-- these functions, the same as public.payment_events and
-- public.process_mercadopago_payment_atomic already enforce.

CREATE TABLE IF NOT EXISTS "public"."order_email_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "order_id" uuid NOT NULL REFERENCES "public"."orders"("id") ON DELETE CASCADE,
  "email_type" text NOT NULL,
  "status" text NOT NULL DEFAULT 'processing',
  "provider_message_id" text,
  "error_code" text,
  "attempted_at" timestamptz,
  "sent_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "order_email_events_email_type_check" CHECK ("email_type" IN ('purchase_confirmation')),
  CONSTRAINT "order_email_events_status_check" CHECK ("status" IN ('processing', 'sent', 'failed')),
  CONSTRAINT "order_email_events_error_code_format_check" CHECK ("error_code" IS NULL OR "error_code" ~ '^[a-z0-9_]{1,80}$'),
  CONSTRAINT "order_email_events_provider_message_id_not_empty_check" CHECK ("provider_message_id" IS NULL OR btrim("provider_message_id") <> ''),
  -- "sent" must always carry the moment it was sent and (once a provider
  -- replies) its message id; neither may linger on a non-terminal row.
  CONSTRAINT "order_email_events_sent_consistency_check" CHECK (
    ("status" = 'sent' AND "sent_at" IS NOT NULL) OR ("status" <> 'sent' AND "sent_at" IS NULL)
  )
);

-- The canonical-row guarantee section 3/4 of the phase asks for: at most one
-- delivery record per (order, email type), full stop.
CREATE UNIQUE INDEX IF NOT EXISTS "idx_order_email_events_order_type_unique"
  ON "public"."order_email_events" ("order_id", "email_type");

CREATE INDEX IF NOT EXISTS "idx_order_email_events_status_attempted"
  ON "public"."order_email_events" ("status", "attempted_at");

ALTER TABLE ONLY "public"."order_email_events" FORCE ROW LEVEL SECURITY;
ALTER TABLE "public"."order_email_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."order_email_events" OWNER TO "postgres";

DROP TRIGGER IF EXISTS "set_updated_at" ON "public"."order_email_events";
CREATE TRIGGER "set_updated_at"
BEFORE UPDATE ON "public"."order_email_events"
FOR EACH ROW
EXECUTE FUNCTION "public"."update_updated_at_column"();

-- Deliberately zero policies: RLS is enabled+forced but grants no role at
-- all (not even authenticated) any access via PostgREST. service_role
-- bypasses RLS entirely, which is the only way this table is ever reached.
REVOKE ALL ON TABLE "public"."order_email_events" FROM PUBLIC, "anon", "authenticated";
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "public"."order_email_events" TO "service_role";

-- 1. claim_order_email_delivery -----------------------------------------------
--
-- Atomically decides, for (p_order_id, p_email_type), whether THIS caller may
-- send. Returns exactly one of:
--   'claimed'            -- caller must send now, then call mark_* below.
--   'already_sent'       -- terminal; caller must not send.
--   'already_processing' -- another live attempt owns this right now.
--
-- Concurrency: the INSERT ... ON CONFLICT DO NOTHING plus the following
-- SELECT ... FOR UPDATE forces two simultaneous callers to serialize on the
-- same row (Postgres blocks the second INSERT on the unique index until the
-- first caller's implicit transaction -- one per RPC call -- commits), so
-- only one caller can ever observe a fresh 'processing' row and return
-- 'claimed'; the other always sees the already-committed row.
--
-- A 'processing' row older than the staleness window is treated as an
-- abandoned attempt (the process that claimed it crashed or timed out before
-- calling mark_sent/mark_failed) and may be reclaimed, otherwise a failed
-- send could never be retried and a crashed one would block forever.
CREATE OR REPLACE FUNCTION "public"."claim_order_email_delivery"(
  "p_order_id" uuid,
  "p_email_type" text
)
RETURNS TABLE ("claim" text, "event_id" uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_row public.order_email_events%ROWTYPE;
  v_stale_after interval := interval '5 minutes';
BEGIN
  IF p_order_id IS NULL OR p_email_type IS NULL OR p_email_type NOT IN ('purchase_confirmation') THEN
    RAISE EXCEPTION 'invalid_request' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.order_email_events (order_id, email_type, status, attempted_at)
  VALUES (p_order_id, p_email_type, 'processing', now())
  ON CONFLICT (order_id, email_type) DO NOTHING
  RETURNING * INTO v_row;

  -- FOUND is only true when this call's own INSERT actually landed a new
  -- row (no prior row existed): that is an unconditional, fresh claim.
  IF FOUND THEN
    RETURN QUERY SELECT 'claimed', v_row.id;
    RETURN;
  END IF;

  -- A row already existed (the INSERT above was skipped by ON CONFLICT):
  -- lock it and decide based on its current state.
  SELECT * INTO v_row
  FROM public.order_email_events
  WHERE order_id = p_order_id AND email_type = p_email_type
  FOR UPDATE;

  IF v_row.status = 'sent' THEN
    RETURN QUERY SELECT 'already_sent', v_row.id;
    RETURN;
  END IF;

  IF v_row.status = 'processing' AND v_row.attempted_at IS NOT NULL AND v_row.attempted_at > now() - v_stale_after THEN
    RETURN QUERY SELECT 'already_processing', v_row.id;
    RETURN;
  END IF;

  -- Either this is the fresh row this call just inserted, a retryable
  -- 'failed' row, or a stale/abandoned 'processing' row past the timeout.
  UPDATE public.order_email_events
  SET status = 'processing', attempted_at = now(), error_code = NULL
  WHERE id = v_row.id;

  RETURN QUERY SELECT 'claimed', v_row.id;
END;
$$;

-- 2. mark_order_email_sent ----------------------------------------------------
--
-- Only transitions a 'processing' row -- never overwrites an already-'sent'
-- row -- enforcing "sent -> no further automatic send" at the data layer
-- itself, not only by caller discipline.
CREATE OR REPLACE FUNCTION "public"."mark_order_email_sent"(
  "p_order_id" uuid,
  "p_email_type" text,
  "p_provider_message_id" text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF p_order_id IS NULL OR p_email_type IS NULL THEN
    RAISE EXCEPTION 'invalid_request' USING ERRCODE = '22023';
  END IF;

  UPDATE public.order_email_events
  SET status = 'sent',
      provider_message_id = NULLIF(btrim(COALESCE(p_provider_message_id, '')), ''),
      sent_at = now(),
      error_code = NULL
  WHERE order_id = p_order_id AND email_type = p_email_type AND status = 'processing';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'invalid_transition' USING ERRCODE = '22023';
  END IF;
END;
$$;

-- 3. mark_order_email_failed --------------------------------------------------
--
-- Same transition guard as mark_order_email_sent: only a 'processing' row
-- may be marked 'failed'. error_code is a stable, sanitized internal code
-- (never a raw provider message, which could carry PII or secrets) --
-- enforced by the same check constraint as the column itself.
CREATE OR REPLACE FUNCTION "public"."mark_order_email_failed"(
  "p_order_id" uuid,
  "p_email_type" text,
  "p_error_code" text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_error_code text := NULLIF(btrim(COALESCE(p_error_code, '')), '');
BEGIN
  IF p_order_id IS NULL OR p_email_type IS NULL THEN
    RAISE EXCEPTION 'invalid_request' USING ERRCODE = '22023';
  END IF;
  IF v_error_code IS NULL OR v_error_code !~ '^[a-z0-9_]{1,80}$' THEN
    RAISE EXCEPTION 'invalid_error_code' USING ERRCODE = '22023';
  END IF;

  UPDATE public.order_email_events
  SET status = 'failed',
      error_code = v_error_code
  WHERE order_id = p_order_id AND email_type = p_email_type AND status = 'processing';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'invalid_transition' USING ERRCODE = '22023';
  END IF;
END;
$$;

-- Backend-only, same boundary as process_mercadopago_payment_atomic: these
-- are never called with a user's own JWT (there is no end-user session in a
-- payment-confirmation context), only with the service role key from
-- server/commerce. No auth.uid()/is_admin() check applies here -- the
-- service_role-only grant below is the entire boundary.
REVOKE ALL ON FUNCTION "public"."claim_order_email_delivery"(uuid, text) FROM PUBLIC, "anon", "authenticated", "service_role";
REVOKE ALL ON FUNCTION "public"."mark_order_email_sent"(uuid, text, text) FROM PUBLIC, "anon", "authenticated", "service_role";
REVOKE ALL ON FUNCTION "public"."mark_order_email_failed"(uuid, text, text) FROM PUBLIC, "anon", "authenticated", "service_role";

GRANT EXECUTE ON FUNCTION "public"."claim_order_email_delivery"(uuid, text) TO "service_role";
GRANT EXECUTE ON FUNCTION "public"."mark_order_email_sent"(uuid, text, text) TO "service_role";
GRANT EXECUTE ON FUNCTION "public"."mark_order_email_failed"(uuid, text, text) TO "service_role";

COMMIT;
