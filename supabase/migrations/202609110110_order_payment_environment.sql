BEGIN;

-- Payment 179962860372 was approved with live_mode true against a Rehabex order
-- that was meant to be a test. Two defects made that unrecoverable:
--
--   1. Checkout returned `init_point ?? sandbox_init_point`, so every buyer was
--      sent to the live Checkout Pro entry point. All 15 stored checkout URLs
--      point at the production host.
--   2. The atomic RPC hardcoded "live_mode must be false". That is correct only
--      while Rehabex is testing: in production it would reject every real
--      payment.
--
-- The expected environment now lives on the order, set once at checkout before
-- any preference exists, and is immutable from then on. Changing MERCADOPAGO_ENV
-- later cannot reclassify an existing order in either direction.

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS payment_environment text NOT NULL DEFAULT 'test';

DO $do$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.orders'::regclass AND conname = 'orders_payment_environment_check'
  ) THEN
    ALTER TABLE public.orders
      ADD CONSTRAINT "orders_payment_environment_check"
      CHECK (payment_environment IN ('test', 'production'));
  END IF;
END
$do$;

-- Backfill: every order that exists today was created while Rehabex was testing.
UPDATE public.orders SET payment_environment = 'test' WHERE payment_environment IS NULL;

-- Immutable once the order has a payment channel. Checkout sets the value
-- before creating the preference; after that nothing may change it.
CREATE OR REPLACE FUNCTION public.freeze_order_payment_environment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $trg$
BEGIN
  IF NEW.payment_environment IS DISTINCT FROM OLD.payment_environment
     AND (OLD.mercadopago_preference_id IS NOT NULL OR OLD.mercadopago_payment_id IS NOT NULL) THEN
    RAISE EXCEPTION 'payment_environment is immutable once the order has a payment channel'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$trg$;

DROP TRIGGER IF EXISTS "orders_freeze_payment_environment" ON public.orders;
CREATE TRIGGER "orders_freeze_payment_environment"
  BEFORE UPDATE ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.freeze_order_payment_environment();

CREATE INDEX IF NOT EXISTS "idx_orders_payment_environment"
  ON public.orders (payment_environment);

CREATE OR REPLACE FUNCTION public.process_mercadopago_payment_atomic(
  p_request_id text,
  p_provider_payment_id text,
  p_external_reference text,
  p_preference_id text,
  p_payment_status text,
  p_amount numeric,
  p_currency text,
  p_live_mode boolean,
  p_payload_hash text
)
RETURNS TABLE (event_id uuid, outcome text, is_duplicate boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_payment_id text := btrim(COALESCE(p_provider_payment_id, ''));
  v_external_reference text := btrim(COALESCE(p_external_reference, ''));
  v_preference_id text := btrim(COALESCE(p_preference_id, ''));
  v_status text := lower(btrim(COALESCE(p_payment_status, '')));
  v_currency text := upper(btrim(COALESCE(p_currency, '')));
  v_dedupe_key text;
  v_event public.payment_events%ROWTYPE;
  v_order public.orders%ROWTYPE;
  v_order_found boolean := false;
  v_item record;
  v_reservation public.stock_reservations%ROWTYPE;
  v_product public.products%ROWTYPE;
  v_reserved integer;
  v_available integer;
  v_stock_available boolean := true;
  v_environment text;
  v_expected_live_mode boolean;
BEGIN
  IF v_payment_id = '' OR length(v_payment_id) > 256
     OR v_external_reference !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
     OR v_preference_id = '' OR length(v_preference_id) > 256
     OR v_status NOT IN ('approved', 'pending', 'in_process', 'rejected', 'cancelled', 'refunded', 'charged_back')
     OR p_amount IS NULL OR p_amount < 0
     OR v_currency = ''
     OR NULLIF(btrim(COALESCE(p_payload_hash, '')), '') IS NULL THEN
    RETURN QUERY SELECT NULL::uuid, 'rejected_payment_shape', false;
    RETURN;
  END IF;

  v_dedupe_key := 'payment:' || v_payment_id || ':status:' || v_status;

  -- The advisory lock covers both rows that already exist and the gap before
  -- the first insert. It makes webhook and reconciliation race identically.
  PERFORM pg_advisory_xact_lock(hashtextextended('mercadopago:' || v_payment_id || ':' || v_status, 0));

  -- Only an event that reached 'processed' applied effects, so only that one
  -- makes a replay a duplicate. A 'failed' or 'ignored' attempt is audit history
  -- and must never consume the idempotency slot of a later, valid retry.
  SELECT * INTO v_event
  FROM public.payment_events AS pe
  WHERE pe.provider = 'mercadopago'
    AND pe.provider_payment_id = v_payment_id
    AND pe.provider_status = v_status
    AND pe.status = 'processed'
  FOR UPDATE;

  IF FOUND THEN
    RETURN QUERY SELECT v_event.id, 'duplicate', true;
    RETURN;
  END IF;

  SELECT * INTO v_order
  FROM public.orders AS o
  WHERE o.id = v_external_reference::uuid
    AND o.external_reference = v_external_reference
  FOR UPDATE;
  v_order_found := FOUND;

  INSERT INTO public.payment_events (
    provider, dedupe_key, request_id, provider_event_id,
    provider_payment_id, order_id, external_reference, signature_valid,
    payload_hash, provider_status, status, raw_payload
  ) VALUES (
    'mercadopago', v_dedupe_key, NULLIF(btrim(COALESCE(p_request_id, '')), ''), NULL,
    v_payment_id, CASE WHEN v_order_found THEN v_order.id ELSE NULL END, v_external_reference, true,
    btrim(p_payload_hash), v_status, 'received', '{}'::jsonb
  )
  RETURNING * INTO v_event;

  IF NOT v_order_found THEN
    UPDATE public.payment_events
    SET status = 'failed', error_code = 'ORDER_NOT_FOUND', processed_at = now()
    WHERE id = v_event.id;
    RETURN QUERY SELECT v_event.id, 'rejected_order_not_found', false;
    RETURN;
  END IF;

  -- The environment is read from the order, never from a caller argument and
  -- never from a deployment variable, so switching Rehabex to production cannot
  -- retroactively make a TEST order accept a real payment. An absent live_mode
  -- is a rejection: unknown is never treated as TEST.
  v_environment := lower(btrim(COALESCE(v_order.payment_environment, '')));
  IF v_environment NOT IN ('test', 'production') THEN
    UPDATE public.payment_events
    SET status = 'failed', error_code = 'ORDER_ENVIRONMENT_UNKNOWN', processed_at = now()
    WHERE id = v_event.id;
    RETURN QUERY SELECT v_event.id, 'rejected_environment_mismatch', false;
    RETURN;
  END IF;

  v_expected_live_mode := (v_environment = 'production');
  IF p_live_mode IS NULL OR p_live_mode <> v_expected_live_mode THEN
    UPDATE public.payment_events
    SET status = 'failed',
        error_code = CASE WHEN v_expected_live_mode THEN 'PRODUCTION_MODE_REQUIRED' ELSE 'TEST_MODE_REQUIRED' END,
        processed_at = now()
    WHERE id = v_event.id;
    RETURN QUERY SELECT v_event.id, 'rejected_environment_mismatch', false;
    RETURN;
  END IF;

  IF v_order.mercadopago_payment_id IS NOT NULL
     AND v_order.mercadopago_payment_id <> v_payment_id THEN
    UPDATE public.payment_events
    SET status = 'failed', error_code = 'PAYMENT_ID_MISMATCH', processed_at = now()
    WHERE id = v_event.id;
    UPDATE public.orders
    SET order_status = 'on_hold', review_required = true,
        review_reason = 'payment_reference_mismatch', updated_at = now()
    WHERE id = v_order.id;
    RETURN QUERY SELECT v_event.id, 'rejected_payment_id_mismatch', false;
    RETURN;
  END IF;

  IF v_order.mercadopago_preference_id IS DISTINCT FROM v_preference_id THEN
    UPDATE public.payment_events
    SET status = 'failed', error_code = 'PREFERENCE_MISMATCH', processed_at = now()
    WHERE id = v_event.id;
    UPDATE public.orders
    SET order_status = 'on_hold', review_required = true,
        review_reason = 'payment_reference_mismatch', updated_at = now()
    WHERE id = v_order.id;
    RETURN QUERY SELECT v_event.id, 'rejected_preference_mismatch', false;
    RETURN;
  END IF;

  IF round(p_amount, 2) <> round(v_order.total_amount, 2) THEN
    UPDATE public.payment_events
    SET status = 'failed', error_code = 'AMOUNT_MISMATCH', processed_at = now()
    WHERE id = v_event.id;
    UPDATE public.orders
    SET order_status = 'on_hold', review_required = true,
        review_reason = 'payment_amount_mismatch', updated_at = now()
    WHERE id = v_order.id;
    RETURN QUERY SELECT v_event.id, 'rejected_amount_mismatch', false;
    RETURN;
  END IF;

  IF v_currency <> 'ARS' OR v_order.currency <> 'ARS' THEN
    UPDATE public.payment_events
    SET status = 'failed', error_code = 'CURRENCY_MISMATCH', processed_at = now()
    WHERE id = v_event.id;
    UPDATE public.orders
    SET order_status = 'on_hold', review_required = true,
        review_reason = 'payment_currency_mismatch', updated_at = now()
    WHERE id = v_order.id;
    RETURN QUERY SELECT v_event.id, 'rejected_currency_mismatch', false;
    RETURN;
  END IF;

  -- Terminal and out-of-order provider states are audited but never regress
  -- the monetary state of the order.
  IF v_order.payment_status IN ('refunded', 'charged_back')
     OR (v_order.payment_status = 'approved' AND v_status NOT IN ('refunded', 'charged_back'))
     OR (v_status IN ('pending', 'in_process') AND v_order.payment_status NOT IN ('unpaid', 'pending'))
     OR (v_status IN ('rejected', 'cancelled') AND v_order.payment_status NOT IN ('unpaid', 'pending', 'rejected', 'cancelled'))
     OR (v_status IN ('refunded', 'charged_back') AND v_order.payment_status <> 'approved') THEN
    UPDATE public.payment_events
    SET status = 'ignored', error_code = 'INVALID_TRANSITION', processed_at = now()
    WHERE id = v_event.id;
    RETURN QUERY SELECT v_event.id, 'ignored_invalid_transition', false;
    RETURN;
  END IF;

  IF v_status = 'approved' THEN
    -- All rows use a stable lock order. Checkout also locks products, so these
    -- locks serialize late stock reacquisition with new reservations.
    PERFORM sr.id
    FROM public.stock_reservations AS sr
    WHERE sr.order_id = v_order.id
    ORDER BY sr.product_id
    FOR UPDATE;

    PERFORM p.id
    FROM public.products AS p
    JOIN public.order_items AS oi ON oi.product_id = p.id
    WHERE oi.order_id = v_order.id
    ORDER BY p.id
    FOR UPDATE OF p;

    -- Phase 1: inspect every line. No reservation, product or movement is
    -- modified until the whole order is known to be fulfillable.
    FOR v_item IN
      SELECT oi.*
      FROM public.order_items AS oi
      WHERE oi.order_id = v_order.id AND oi.product_id IS NOT NULL
      ORDER BY oi.product_id
    LOOP
      SELECT * INTO v_product
      FROM public.products AS p
      WHERE p.id = v_item.product_id;

      IF NOT FOUND OR v_product.track_stock IS DISTINCT FROM true THEN
        CONTINUE;
      END IF;

      SELECT * INTO v_reservation
      FROM public.stock_reservations AS sr
      WHERE sr.order_id = v_order.id AND sr.product_id = v_item.product_id;

      IF FOUND AND v_reservation.status = 'consumed' THEN
        CONTINUE;
      END IF;

      IF FOUND AND v_reservation.status = 'active' AND v_reservation.expires_at > now() THEN
        v_available := v_product.stock_on_hand;
      ELSE
        SELECT COALESCE(sum(sr.quantity), 0)::integer INTO v_reserved
        FROM public.stock_reservations AS sr
        WHERE sr.product_id = v_item.product_id
          AND sr.order_id <> v_order.id
          AND sr.status = 'active'
          AND sr.expires_at > now();
        v_available := v_product.stock_on_hand - v_reserved;
      END IF;

      IF v_available < v_item.quantity OR v_product.stock_on_hand < v_item.quantity THEN
        v_stock_available := false;
      END IF;
    END LOOP;

    IF NOT v_stock_available THEN
      UPDATE public.orders
      SET payment_status = 'approved', order_status = 'on_hold',
          fulfillment_status = 'not_started', review_required = true,
          review_reason = 'late_approved_payment_no_stock',
          refund_required = true, refund_required_at = COALESCE(refund_required_at, now()),
          refund_required_reason = COALESCE(refund_required_reason, 'late approved payment without available stock'),
          mercadopago_payment_id = v_payment_id, paid_at = COALESCE(paid_at, now()), updated_at = now()
      WHERE id = v_order.id;
      UPDATE public.payment_events
      SET status = 'processed', processed_at = now()
      WHERE id = v_event.id;
      RETURN QUERY SELECT v_event.id, 'review_refund_required', false;
      RETURN;
    END IF;

    -- Phase 2: every line passed preflight while all products stayed locked.
    FOR v_item IN
      SELECT oi.*
      FROM public.order_items AS oi
      WHERE oi.order_id = v_order.id AND oi.product_id IS NOT NULL
      ORDER BY oi.product_id
    LOOP
      SELECT * INTO v_product
      FROM public.products AS p
      WHERE p.id = v_item.product_id;

      IF NOT FOUND OR v_product.track_stock IS DISTINCT FROM true THEN
        CONTINUE;
      END IF;

      SELECT * INTO v_reservation
      FROM public.stock_reservations AS sr
      WHERE sr.order_id = v_order.id AND sr.product_id = v_item.product_id;

      IF FOUND AND v_reservation.status = 'consumed' THEN
        CONTINUE;
      END IF;

      IF FOUND AND v_reservation.status = 'active' AND v_reservation.expires_at > now() THEN
        UPDATE public.stock_reservations
        SET status = 'consumed', consumed_at = now()
        WHERE id = v_reservation.id;
      ELSIF FOUND AND v_reservation.status = 'active' THEN
        UPDATE public.stock_reservations
        SET status = 'expired', released_at = now()
        WHERE id = v_reservation.id;
      END IF;

      UPDATE public.products
      SET stock_on_hand = stock_on_hand - v_item.quantity, updated_at = now()
      WHERE id = v_item.product_id AND stock_on_hand >= v_item.quantity;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'STOCK_CHANGED_AFTER_PREFLIGHT' USING ERRCODE = '40001';
      END IF;

      INSERT INTO public.inventory_movements (
        product_id, order_id, reservation_id, movement_type, quantity_delta, reason
      ) VALUES (
        v_item.product_id, v_order.id, v_reservation.id, 'sale', -v_item.quantity, 'payment approved'
      );
    END LOOP;

    UPDATE public.orders
    SET payment_status = 'approved', order_status = 'confirmed',
        fulfillment_status = 'not_started', mercadopago_payment_id = v_payment_id,
        paid_at = COALESCE(paid_at, now()), updated_at = now()
    WHERE id = v_order.id;

  ELSIF v_status IN ('pending', 'in_process') THEN
    UPDATE public.orders
    SET payment_status = 'pending', order_status = 'pending_payment', updated_at = now()
    WHERE id = v_order.id;

  ELSIF v_status IN ('rejected', 'cancelled') THEN
    PERFORM sr.id
    FROM public.stock_reservations AS sr
    WHERE sr.order_id = v_order.id
    ORDER BY sr.product_id
    FOR UPDATE;

    UPDATE public.stock_reservations
    SET status = 'released', released_at = now()
    WHERE order_id = v_order.id AND status = 'active';

    UPDATE public.orders
    SET payment_status = CASE WHEN v_status = 'rejected' THEN 'rejected'::public.payment_status ELSE 'cancelled'::public.payment_status END,
        order_status = CASE WHEN v_status = 'rejected' THEN 'failed'::public.order_status ELSE 'cancelled'::public.order_status END,
        updated_at = now()
    WHERE id = v_order.id;

  ELSIF v_status = 'refunded' THEN
    UPDATE public.orders
    SET payment_status = 'refunded', order_status = 'refunded', updated_at = now()
    WHERE id = v_order.id;

  ELSIF v_status = 'charged_back' THEN
    UPDATE public.orders
    SET payment_status = 'charged_back', order_status = 'on_hold',
        review_required = true, review_reason = 'provider_dispute',
        refund_required = true, refund_required_at = COALESCE(refund_required_at, now()),
        refund_required_reason = COALESCE(refund_required_reason, 'provider chargeback'), updated_at = now()
    WHERE id = v_order.id;
  END IF;

  UPDATE public.payment_events
  SET status = 'processed', processed_at = now()
  WHERE id = v_event.id;

  RETURN QUERY SELECT v_event.id, v_status, false;
END;
$$;

REVOKE ALL ON FUNCTION public.process_mercadopago_payment_atomic(text, text, text, text, text, numeric, text, boolean, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.process_mercadopago_payment_atomic(text, text, text, text, text, numeric, text, boolean, text)
  TO service_role;
REVOKE ALL ON FUNCTION public.freeze_order_payment_environment() FROM PUBLIC, anon, authenticated, service_role;

COMMIT;
