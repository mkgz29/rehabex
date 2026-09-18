BEGIN;

-- Commerce must not depend on a webhook that may never arrive. This migration
-- adds the two pieces the recovery channel needs:
--   1. a per-order cooldown so polling cannot hammer the provider;
--   2. idempotent expiry of holds whose checkout window already closed.
-- It changes no order, reservation, stock or payment data on its own.

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS payment_sync_last_attempt_at timestamp with time zone;

-- ---------------------------------------------------------------------------
-- Per-order cooldown for provider recovery lookups.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.claim_payment_recovery_attempt(
  p_order_id uuid,
  p_cooldown_seconds integer
)
RETURNS TABLE (allowed boolean, retry_after_seconds integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_cooldown integer := GREATEST(1, LEAST(COALESCE(p_cooldown_seconds, 30), 3600));
  v_last timestamp with time zone;
BEGIN
  IF p_order_id IS NULL THEN
    RETURN QUERY SELECT false, v_cooldown;
    RETURN;
  END IF;

  -- Serializes concurrent tabs polling the same order.
  PERFORM pg_advisory_xact_lock(hashtextextended('payment_recovery:' || p_order_id::text, 0));

  SELECT o.payment_sync_last_attempt_at INTO v_last
  FROM public.orders AS o
  WHERE o.id = p_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, v_cooldown;
    RETURN;
  END IF;

  IF v_last IS NOT NULL AND v_last > now() - make_interval(secs => v_cooldown) THEN
    RETURN QUERY SELECT false,
      GREATEST(1, ceil(extract(epoch FROM (v_last + make_interval(secs => v_cooldown)) - now()))::integer);
    RETURN;
  END IF;

  UPDATE public.orders
  SET payment_sync_last_attempt_at = now()
  WHERE id = p_order_id;

  RETURN QUERY SELECT true, 0;
END;
$$;

-- ---------------------------------------------------------------------------
-- Idempotent expiry of stale holds.
-- ---------------------------------------------------------------------------
-- Reservations never hold units themselves: stock_on_hand only moves on an
-- approved sale. Expiring a reservation therefore releases nothing by hand, it
-- only stops the row from counting against availability.
CREATE OR REPLACE FUNCTION public.expire_stale_commerce_holds(
  p_limit integer DEFAULT 200
)
RETURNS TABLE (reservations_expired integer, orders_expired integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_limit integer := GREATEST(1, LEAST(COALESCE(p_limit, 200), 1000));
  v_reservations integer := 0;
  v_orders integer := 0;
BEGIN
  WITH stale AS (
    SELECT sr.id
    FROM public.stock_reservations AS sr
    WHERE sr.status = 'active' AND sr.expires_at <= now()
    ORDER BY sr.expires_at
    LIMIT v_limit
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.stock_reservations AS sr
  SET status = 'expired', released_at = COALESCE(sr.released_at, now())
  FROM stale
  WHERE sr.id = stale.id;
  GET DIAGNOSTICS v_reservations = ROW_COUNT;

  -- Only order_status moves here. payment_status is deliberately left alone so
  -- a late approved payment still passes the atomic processor's transition
  -- guard and is handled there (confirmed, or on_hold with refund_required).
  WITH stale_orders AS (
    SELECT o.id
    FROM public.orders AS o
    WHERE o.order_status = 'pending_payment'
      AND o.payment_status IN ('unpaid', 'pending')
      AND o.mercadopago_payment_id IS NULL
      AND o.reservation_expires_at IS NOT NULL
      AND o.reservation_expires_at <= now()
    ORDER BY o.reservation_expires_at
    LIMIT v_limit
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.orders AS o
  SET order_status = 'expired', updated_at = now()
  FROM stale_orders
  WHERE o.id = stale_orders.id;
  GET DIAGNOSTICS v_orders = ROW_COUNT;

  RETURN QUERY SELECT v_reservations, v_orders;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_payment_recovery_attempt(uuid, integer)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.expire_stale_commerce_holds(integer)
  FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.claim_payment_recovery_attempt(uuid, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.expire_stale_commerce_holds(integer) TO service_role;

COMMIT;
