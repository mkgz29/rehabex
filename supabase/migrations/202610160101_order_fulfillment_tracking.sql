BEGIN;

-- FASE 7F-B4: order fulfillment tracking.
--
-- orders.fulfillment_status and the public.fulfillment_status enum
-- ('not_started','preparing','ready_for_pickup','shipped','delivered',
-- 'cancelled','returned') already exist (202609110103) and are already set
-- to 'not_started' by process_mercadopago_payment_atomic the moment a
-- payment is approved. This migration does NOT add a new column or a new
-- enum -- it adds the state machine (enforced only inside the new RPC, not
-- as a DB constraint, so it can be refined without a type-rewriting
-- migration), an append-only history table, and a guest tracking token
-- distinct from the checkout session's own status token (see below).
--
-- 'not_started' is this phase's "confirmed" (payment confirmed, fulfillment
-- not started yet) -- no new enum value was added for it, reusing the
-- existing one instead of forcing an ALTER TYPE on a live production enum.
-- 'returned' exists in the enum but is intentionally not reachable from any
-- transition in this phase (no return flow designed yet); it is left alone
-- for a future phase.

-- 1. order_fulfillment_events: append-only history --------------------------

CREATE TABLE IF NOT EXISTS "public"."order_fulfillment_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "order_id" uuid NOT NULL REFERENCES "public"."orders"("id") ON DELETE CASCADE,
  "from_status" "public"."fulfillment_status",
  "to_status" "public"."fulfillment_status" NOT NULL,
  "event_type" text NOT NULL DEFAULT 'status_changed',
  "note" text,
  "created_by" uuid REFERENCES "auth"."users"("id") ON DELETE SET NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "order_fulfillment_events_event_type_check" CHECK ("event_type" IN ('status_changed')),
  CONSTRAINT "order_fulfillment_events_note_length_check" CHECK ("note" IS NULL OR length("note") <= 500)
);

CREATE INDEX IF NOT EXISTS "idx_order_fulfillment_events_order_created" ON "public"."order_fulfillment_events" ("order_id", "created_at" DESC);

ALTER TABLE ONLY "public"."order_fulfillment_events" FORCE ROW LEVEL SECURITY;
ALTER TABLE "public"."order_fulfillment_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."order_fulfillment_events" OWNER TO "postgres";

-- Admin may SELECT directly (same pattern as inventory_movements/
-- stock_reservations/payment_events); there is deliberately no INSERT/
-- UPDATE/DELETE policy for any client role -- the only writer is the
-- SECURITY DEFINER RPC below, which runs as the table owner. A guest never
-- gets a policy here at all: /api/order-status reads this table with the
-- service_role client and returns only an explicit, sanitized projection
-- (see server/commerce, not this migration) -- "lectura pública siempre
-- pasa por API segura", never a direct grant.
DROP POLICY IF EXISTS "admin read order fulfillment events" ON "public"."order_fulfillment_events";
CREATE POLICY "admin read order fulfillment events"
ON "public"."order_fulfillment_events"
FOR SELECT
TO "authenticated"
USING (public.is_admin());

REVOKE ALL ON TABLE "public"."order_fulfillment_events" FROM PUBLIC, "anon";
GRANT SELECT ON TABLE "public"."order_fulfillment_events" TO "authenticated";
GRANT SELECT, INSERT ON TABLE "public"."order_fulfillment_events" TO "service_role";

-- 2. Guest tracking token for the email link ---------------------------------
--
-- The checkout session's own status_access_token_hash cannot be reused for
-- the "Ver mi pedido" email link: only its hash is ever persisted (by
-- design, same zero-knowledge model as every other token in this project),
-- so the plaintext is gone from the server the moment checkout responds.
-- A second, independent token is minted specifically when the confirmation
-- email is built (server/commerce/purchaseEmailDelivery.ts, a later
-- commit in this phase) and stored here, hashed the same way. /api/order-status
-- accepts EITHER hash -- the live checkout tab's own token keeps working
-- exactly as before, and the emailed link works independently of it, with
-- no session-storage dependency. Nullable: most orders never need one until
-- an email is actually sent.
ALTER TABLE "public"."orders"
  ADD COLUMN IF NOT EXISTS "tracking_token_hash" text;

CREATE UNIQUE INDEX IF NOT EXISTS "idx_orders_tracking_token_hash_unique" ON "public"."orders" ("tracking_token_hash") WHERE "tracking_token_hash" IS NOT NULL;

-- 3. admin_update_order_fulfillment_status -----------------------------------
--
-- Explicit state machine, gated on the order's own delivery_method so a
-- pickup order never offers "shipped" and a delivery order never offers
-- "ready_for_pickup". Never touches payment_status/order_status/paid_at/any
-- payment id -- those remain exclusively owned by
-- process_mercadopago_payment_atomic. Requires the order to already be
-- order_status='confirmed' (i.e. payment approved): fulfillment has no
-- meaning before that, and this also keeps the RPC from ever being used to
-- route around the payment flow.
CREATE OR REPLACE FUNCTION "public"."admin_update_order_fulfillment_status"(
  "p_order_id" uuid,
  "p_to_status" text,
  "p_note" text,
  "p_request_id" uuid
)
RETURNS "public"."orders"
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_order public.orders;
  v_from public.fulfillment_status;
  v_to public.fulfillment_status;
  v_note text := NULLIF(btrim(COALESCE(p_note, '')), '');
  v_allowed boolean := false;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE = 'ADM01'; END IF;
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = 'ADM03'; END IF;
  IF p_order_id IS NULL OR p_request_id IS NULL THEN RAISE EXCEPTION 'invalid_request' USING ERRCODE = 'ADM22'; END IF;
  IF v_note IS NOT NULL AND length(v_note) > 500 THEN RAISE EXCEPTION 'invalid_note' USING ERRCODE = 'ADM22'; END IF;

  IF p_to_status NOT IN ('preparing', 'ready_for_pickup', 'shipped', 'delivered', 'cancelled') THEN
    RAISE EXCEPTION 'invalid_status' USING ERRCODE = 'ADM22';
  END IF;
  v_to := p_to_status::public.fulfillment_status;

  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found' USING ERRCODE = 'ADM04'; END IF;
  IF v_order.order_status <> 'confirmed' THEN RAISE EXCEPTION 'order_not_confirmed' USING ERRCODE = 'ADM22'; END IF;

  -- State machine, gated by delivery_method. 'delivered' and 'cancelled' are
  -- terminal: neither appears as a source state below, so nothing can ever
  -- transition out of them (delivered -> preparing, cancelled -> shipped,
  -- etc. are all structurally impossible, not just undocumented).
  v_allowed := CASE v_order.fulfillment_status
    WHEN 'not_started' THEN v_to IN ('preparing', 'cancelled')
    WHEN 'preparing' THEN
      (v_order.delivery_method = 'pickup' AND v_to IN ('ready_for_pickup', 'cancelled'))
      OR (v_order.delivery_method = 'delivery' AND v_to IN ('shipped', 'cancelled'))
    WHEN 'ready_for_pickup' THEN v_to IN ('delivered', 'cancelled')
    WHEN 'shipped' THEN v_to IN ('delivered', 'cancelled')
    ELSE false
  END;
  IF NOT v_allowed THEN RAISE EXCEPTION 'invalid_transition' USING ERRCODE = 'ADM22'; END IF;

  v_from := v_order.fulfillment_status;

  UPDATE public.orders SET fulfillment_status = v_to, updated_at = now()
  WHERE id = p_order_id
  RETURNING * INTO v_order;

  INSERT INTO public.order_fulfillment_events (order_id, from_status, to_status, note, created_by)
  VALUES (p_order_id, v_from, v_to, v_note, v_actor);

  INSERT INTO public.admin_audit_events (actor_id, action, entity_type, entity_id, request_id, before_state, after_state)
  VALUES (
    v_actor, 'order.fulfillment_status_changed', 'order', p_order_id::text, p_request_id,
    jsonb_build_object('fulfillment_status', v_from),
    jsonb_build_object('fulfillment_status', v_to)
  );

  RETURN v_order;
EXCEPTION
  WHEN unique_violation THEN RAISE EXCEPTION 'duplicate_request' USING ERRCODE = 'ADM09';
END;
$$;

REVOKE ALL ON FUNCTION "public"."admin_update_order_fulfillment_status"(uuid, text, text, uuid) FROM PUBLIC, "anon", "authenticated";
GRANT EXECUTE ON FUNCTION "public"."admin_update_order_fulfillment_status"(uuid, text, text, uuid) TO "authenticated";

COMMIT;
