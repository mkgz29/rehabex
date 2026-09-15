BEGIN;

-- Checkout configuration is data, never browser input. A missing setting is
-- deliberately represented by a safe zero-cost default until an administrator
-- configures the fixed delivery price.
INSERT INTO public.settings ("key", "value")
VALUES ('commerce_shipping', jsonb_build_object('fixed_amount', 0))
ON CONFLICT ("key") DO NOTHING;

ALTER TABLE public.payment_events
  ADD COLUMN IF NOT EXISTS "dedupe_key" text,
  ADD COLUMN IF NOT EXISTS "provider_status" text;

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS "refund_required" boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "refund_required_at" timestamp with time zone,
  ADD COLUMN IF NOT EXISTS "refund_required_reason" text,
  ADD COLUMN IF NOT EXISTS "mercadopago_checkout_url" text,
  ADD COLUMN IF NOT EXISTS "mercadopago_preference_lease_token" uuid,
  ADD COLUMN IF NOT EXISTS "mercadopago_preference_lease_expires_at" timestamp with time zone,
  ADD COLUMN IF NOT EXISTS "mercadopago_preference_attempts" integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "mercadopago_preference_last_error" text,
  ADD COLUMN IF NOT EXISTS "mercadopago_preference_reconciliation_required" boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS public.commerce_rate_limit_windows (
  "scope" text NOT NULL CHECK ("scope" IN ('checkout_ip', 'checkout_idempotency', 'order_status_ip')),
  "subject_hash" text NOT NULL CHECK ("subject_hash" ~ '^[a-f0-9]{64}$'),
  "window_started_at" timestamp with time zone NOT NULL,
  "request_count" integer NOT NULL CHECK ("request_count" >= 0),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY ("scope", "subject_hash", "window_started_at")
);

ALTER TABLE public.commerce_rate_limit_windows ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.commerce_rate_limit_windows FORCE ROW LEVEL SECURITY;

-- Historic events intentionally have no synthetic key. New webhook writes must
-- provide one, and the partial index keeps the migration backward compatible.
CREATE UNIQUE INDEX IF NOT EXISTS "idx_payment_events_provider_dedupe_unique"
  ON public.payment_events ("provider", "dedupe_key")
  WHERE "dedupe_key" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "idx_commerce_rate_limit_windows_expiry"
  ON public.commerce_rate_limit_windows ("window_started_at");

CREATE OR REPLACE FUNCTION public.consume_commerce_rate_limit(
  p_scope text,
  p_subject_hashes text[]
)
RETURNS TABLE (allowed boolean, retry_after_seconds integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_window_seconds integer;
  v_subject_limit integer;
  v_window_started_at timestamp with time zone;
  v_subject_hash text;
  v_count integer;
  v_retry integer;
BEGIN
  IF p_scope = 'checkout' THEN
    v_window_seconds := 600;
  ELSIF p_scope = 'order_status' THEN
    v_window_seconds := 60;
  ELSE
    RAISE EXCEPTION 'unsupported rate limit scope' USING ERRCODE = '22023';
  END IF;

  IF p_subject_hashes IS NULL OR cardinality(p_subject_hashes) < 1 OR cardinality(p_subject_hashes) > 2 THEN
    RAISE EXCEPTION 'invalid rate limit subjects' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM unnest(p_subject_hashes) AS h WHERE h !~ '^[a-f0-9]{64}$') THEN
    RAISE EXCEPTION 'invalid rate limit subject hash' USING ERRCODE = '22023';
  END IF;

  v_window_started_at := to_timestamp(floor(extract(epoch FROM clock_timestamp()) / v_window_seconds) * v_window_seconds);
  v_retry := GREATEST(1, ceil(extract(epoch FROM (v_window_started_at + make_interval(secs => v_window_seconds)) - clock_timestamp()))::integer);

  -- Serialize the whole subject set in a stable order. This avoids a partial
  -- consume when one of checkout's two dimensions is already exhausted.
  FOREACH v_subject_hash IN ARRAY (SELECT array_agg(h ORDER BY h) FROM unnest(p_subject_hashes) AS h)
  LOOP
    PERFORM pg_advisory_xact_lock(hashtextextended(p_scope || ':' || v_subject_hash, 0));
  END LOOP;

  FOREACH v_subject_hash IN ARRAY p_subject_hashes
  LOOP
    v_subject_limit := CASE WHEN p_scope = 'checkout' AND v_subject_hash = p_subject_hashes[1] THEN 5
                            WHEN p_scope = 'checkout' THEN 3 ELSE 20 END;
    SELECT request_count INTO v_count
    FROM public.commerce_rate_limit_windows
    WHERE scope = CASE WHEN p_scope = 'checkout' AND v_subject_hash = p_subject_hashes[1] THEN 'checkout_ip'
                       WHEN p_scope = 'checkout' THEN 'checkout_idempotency'
                       ELSE 'order_status_ip' END
      AND subject_hash = v_subject_hash
      AND window_started_at = v_window_started_at
    FOR UPDATE;
    IF FOUND AND v_count >= v_subject_limit THEN
      RETURN QUERY SELECT false, v_retry;
      RETURN;
    END IF;
  END LOOP;

  FOREACH v_subject_hash IN ARRAY p_subject_hashes
  LOOP
    INSERT INTO public.commerce_rate_limit_windows (scope, subject_hash, window_started_at, request_count, updated_at)
    VALUES (
      CASE WHEN p_scope = 'checkout' AND v_subject_hash = p_subject_hashes[1] THEN 'checkout_ip'
           WHEN p_scope = 'checkout' THEN 'checkout_idempotency'
           ELSE 'order_status_ip' END,
      v_subject_hash, v_window_started_at, 1, now()
    )
    ON CONFLICT (scope, subject_hash, window_started_at)
    DO UPDATE SET request_count = public.commerce_rate_limit_windows.request_count + 1, updated_at = now();
  END LOOP;

  RETURN QUERY SELECT true, 0;
END;
$$;

CREATE OR REPLACE FUNCTION public.purge_commerce_rate_limit_windows()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE v_deleted integer;
BEGIN
  DELETE FROM public.commerce_rate_limit_windows
  WHERE window_started_at < clock_timestamp() - interval '24 hours';
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

CREATE OR REPLACE FUNCTION public.claim_mercadopago_preference_creation(
  p_order_id uuid,
  p_lease_token uuid,
  p_lease_seconds integer DEFAULT 90
)
RETURNS TABLE (claim_status text, preference_id text, checkout_url text, provider_idempotency_key text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_order public.orders%ROWTYPE;
BEGIN
  IF p_lease_token IS NULL OR p_lease_seconds < 30 OR p_lease_seconds > 300 THEN
    RAISE EXCEPTION 'invalid preference lease' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'order not found' USING ERRCODE = '22023'; END IF;
  IF v_order.mercadopago_preference_id IS NOT NULL AND v_order.mercadopago_checkout_url IS NOT NULL THEN
    RETURN QUERY SELECT 'ready', v_order.mercadopago_preference_id, v_order.mercadopago_checkout_url, v_order.idempotency_key::text;
    RETURN;
  END IF;
  IF v_order.order_status <> 'pending_payment' THEN
    RETURN QUERY SELECT 'reconciliation_required', NULL::text, NULL::text, v_order.idempotency_key::text;
    RETURN;
  END IF;
  IF v_order.mercadopago_preference_reconciliation_required THEN
    RETURN QUERY SELECT 'reconciliation_required', NULL::text, NULL::text, v_order.idempotency_key::text;
    RETURN;
  END IF;
  IF v_order.mercadopago_preference_lease_expires_at IS NOT NULL
     AND v_order.mercadopago_preference_lease_expires_at > clock_timestamp()
     AND v_order.mercadopago_preference_lease_token IS DISTINCT FROM p_lease_token THEN
    RETURN QUERY SELECT 'processing', NULL::text, NULL::text, v_order.idempotency_key::text;
    RETURN;
  END IF;
  IF v_order.mercadopago_preference_lease_expires_at IS NOT NULL
     AND v_order.mercadopago_preference_lease_expires_at <= clock_timestamp() THEN
    UPDATE public.orders
    SET mercadopago_preference_reconciliation_required = true,
        mercadopago_preference_last_error = 'preference_creation_lease_expired', updated_at = now()
    WHERE id = p_order_id;
    RETURN QUERY SELECT 'reconciliation_required', NULL::text, NULL::text, v_order.idempotency_key::text;
    RETURN;
  END IF;
  UPDATE public.orders
  SET mercadopago_preference_lease_token = p_lease_token,
      mercadopago_preference_lease_expires_at = clock_timestamp() + make_interval(secs => p_lease_seconds),
      mercadopago_preference_attempts = mercadopago_preference_attempts + 1,
      updated_at = now()
  WHERE id = p_order_id;
  RETURN QUERY SELECT 'claimed', NULL::text, NULL::text, v_order.idempotency_key::text;
END;
$$;

CREATE OR REPLACE FUNCTION public.reconcile_mercadopago_preference_creation(
  p_order_id uuid,
  p_confirmed_absent boolean,
  p_preference_id text DEFAULT NULL,
  p_checkout_url text DEFAULT NULL
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE v_order public.orders%ROWTYPE;
BEGIN
  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'order not found' USING ERRCODE = '22023'; END IF;
  IF NOT v_order.mercadopago_preference_reconciliation_required THEN
    RAISE EXCEPTION 'order does not require preference reconciliation' USING ERRCODE = '55000';
  END IF;
  IF p_preference_id IS NOT NULL OR p_checkout_url IS NOT NULL THEN
    IF NULLIF(btrim(COALESCE(p_preference_id, '')), '') IS NULL OR NULLIF(btrim(COALESCE(p_checkout_url, '')), '') IS NULL THEN
      RAISE EXCEPTION 'both reconciled preference values are required' USING ERRCODE = '22023';
    END IF;
    IF v_order.mercadopago_preference_id IS NOT NULL AND v_order.mercadopago_preference_id <> btrim(p_preference_id) THEN
      RAISE EXCEPTION 'order already has a different preference' USING ERRCODE = '23505';
    END IF;
    UPDATE public.orders
    SET mercadopago_preference_id = btrim(p_preference_id), mercadopago_checkout_url = btrim(p_checkout_url),
        mercadopago_preference_lease_token = NULL, mercadopago_preference_lease_expires_at = NULL,
        mercadopago_preference_reconciliation_required = false, mercadopago_preference_last_error = NULL, updated_at = now()
    WHERE id = p_order_id;
    RETURN 'ready';
  END IF;
  IF p_confirmed_absent IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'provider absence must be explicitly confirmed' USING ERRCODE = '22023';
  END IF;
  UPDATE public.orders
  SET mercadopago_preference_lease_token = NULL, mercadopago_preference_lease_expires_at = NULL,
      mercadopago_preference_reconciliation_required = false, mercadopago_preference_last_error = 'provider_preference_absence_confirmed', updated_at = now()
  WHERE id = p_order_id;
  RETURN 'reopened';
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_mercadopago_preference_creation(
  p_order_id uuid,
  p_lease_token uuid,
  p_preference_id text,
  p_checkout_url text
)
RETURNS TABLE (claim_status text, preference_id text, checkout_url text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE v_order public.orders%ROWTYPE;
BEGIN
  IF p_lease_token IS NULL OR NULLIF(btrim(COALESCE(p_preference_id, '')), '') IS NULL
     OR NULLIF(btrim(COALESCE(p_checkout_url, '')), '') IS NULL THEN
    RAISE EXCEPTION 'invalid preference completion' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'order not found' USING ERRCODE = '22023'; END IF;
  IF v_order.mercadopago_preference_id IS NOT NULL THEN
    IF v_order.mercadopago_preference_id = btrim(p_preference_id)
       AND v_order.mercadopago_checkout_url = btrim(p_checkout_url) THEN
      RETURN QUERY SELECT 'ready', v_order.mercadopago_preference_id, v_order.mercadopago_checkout_url;
      RETURN;
    END IF;
    RAISE EXCEPTION 'order already has a different preference' USING ERRCODE = '23505';
  END IF;
  IF v_order.mercadopago_preference_lease_token IS DISTINCT FROM p_lease_token THEN
    RAISE EXCEPTION 'PREFERENCE_LEASE_NOT_OWNED' USING ERRCODE = '55000';
  END IF;
  UPDATE public.orders
  SET mercadopago_preference_id = btrim(p_preference_id), mercadopago_checkout_url = btrim(p_checkout_url),
      mercadopago_preference_lease_token = NULL, mercadopago_preference_lease_expires_at = NULL,
      mercadopago_preference_last_error = NULL, updated_at = now()
  WHERE id = p_order_id;
  RETURN QUERY SELECT 'ready', btrim(p_preference_id), btrim(p_checkout_url);
END;
$$;

CREATE OR REPLACE FUNCTION public.fail_mercadopago_preference_creation(
  p_order_id uuid,
  p_lease_token uuid,
  p_error_code text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NULLIF(btrim(COALESCE(p_error_code, '')), '') IS NULL OR length(p_error_code) > 80 THEN
    RAISE EXCEPTION 'invalid preference error code' USING ERRCODE = '22023';
  END IF;
  UPDATE public.orders
  SET mercadopago_preference_reconciliation_required = true,
      mercadopago_preference_last_error = btrim(p_error_code), updated_at = now()
  WHERE id = p_order_id AND mercadopago_preference_lease_token = p_lease_token
    AND mercadopago_preference_id IS NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_checkout_shipping_amount(
  p_delivery_method public.delivery_method
)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_value jsonb;
  v_amount numeric;
BEGIN
  IF p_delivery_method = 'pickup' THEN
    RETURN 0;
  END IF;

  SELECT s.value INTO v_value
  FROM public.settings AS s
  WHERE s.key = 'commerce_shipping'
  FOR SHARE;

  v_amount := NULLIF(v_value->>'fixed_amount', '')::numeric;
  IF v_amount IS NULL OR v_amount < 0 OR v_amount > 100000000 THEN
    RAISE EXCEPTION 'commerce_shipping.fixed_amount is invalid' USING ERRCODE = '22023';
  END IF;

  RETURN round(v_amount, 2);
END;
$$;

-- Wrapper with no caller-controlled shipping or discount values. The original
-- 103 function remains available only to service_role for backwards-compatible
-- administration; application checkout must use this version.
CREATE OR REPLACE FUNCTION public.create_checkout_order_v2(
  p_idempotency_key uuid,
  p_checkout_request_hash text,
  p_user_id uuid,
  p_customer_email text,
  p_customer_name text,
  p_customer_phone text,
  p_delivery_method public.delivery_method,
  p_delivery_payload jsonb,
  p_items jsonb,
  p_status_access_token_hash text,
  p_reservation_minutes integer DEFAULT 15
)
RETURNS TABLE (
  order_id uuid,
  order_number text,
  subtotal_amount numeric,
  shipping_amount numeric,
  discount_amount numeric,
  total_amount numeric,
  currency text,
  reservation_expires_at timestamp with time zone
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF p_delivery_method IS NULL THEN
    RAISE EXCEPTION 'delivery method is required' USING ERRCODE = '22023';
  END IF;
  IF p_delivery_method = 'delivery' AND (
    NULLIF(btrim(COALESCE(p_delivery_payload->>'recipientName', '')), '') IS NULL
    OR NULLIF(btrim(COALESCE(p_delivery_payload->>'addressLine1', '')), '') IS NULL
    OR NULLIF(btrim(COALESCE(p_delivery_payload->>'city', '')), '') IS NULL
    OR NULLIF(btrim(COALESCE(p_delivery_payload->>'province', '')), '') IS NULL
    OR NULLIF(btrim(COALESCE(p_delivery_payload->>'postalCode', '')), '') IS NULL
  ) THEN
    RAISE EXCEPTION 'complete delivery address is required' USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  SELECT * FROM public.create_checkout_order(
    p_idempotency_key, p_checkout_request_hash, p_user_id,
    p_customer_email, p_customer_name, p_customer_phone,
    p_delivery_method, p_delivery_payload, p_items,
    p_status_access_token_hash,
    public.get_checkout_shipping_amount(p_delivery_method), 0,
    p_reservation_minutes
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.attach_mercadopago_preference(
  p_order_id uuid,
  p_preference_id text,
  p_checkout_url text
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_order public.orders%ROWTYPE;
BEGIN
  IF p_preference_id IS NULL OR btrim(p_preference_id) = ''
     OR p_checkout_url IS NULL OR btrim(p_checkout_url) = '' THEN
    RAISE EXCEPTION 'preference id and checkout url are required' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'order not found' USING ERRCODE = '22023';
  END IF;
  IF v_order.external_reference IS DISTINCT FROM p_order_id::text THEN
    RAISE EXCEPTION 'order external reference mismatch' USING ERRCODE = '22023';
  END IF;
  IF v_order.mercadopago_preference_id IS NOT NULL
     AND v_order.mercadopago_preference_id <> btrim(p_preference_id) THEN
    RAISE EXCEPTION 'order already has a different preference' USING ERRCODE = '23505';
  END IF;
  IF v_order.order_status NOT IN ('pending_payment', 'expired') THEN
    RAISE EXCEPTION 'order cannot receive a preference in status %', v_order.order_status USING ERRCODE = '22023';
  END IF;

  UPDATE public.orders
  SET mercadopago_preference_id = btrim(p_preference_id),
      mercadopago_checkout_url = COALESCE(mercadopago_checkout_url, btrim(p_checkout_url)),
      updated_at = now()
  WHERE id = p_order_id;
  RETURN btrim(p_preference_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.record_mercadopago_payment_event(
  p_dedupe_key text,
  p_request_id text,
  p_provider_event_id text,
  p_provider_payment_id text,
  p_order_id uuid,
  p_external_reference text,
  p_payload_hash text,
  p_provider_status text
)
RETURNS TABLE (event_id uuid, is_duplicate boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_event_id uuid;
BEGIN
  IF p_dedupe_key IS NULL OR btrim(p_dedupe_key) = ''
     OR p_payload_hash IS NULL OR btrim(p_payload_hash) = '' THEN
    RAISE EXCEPTION 'dedupe key and payload hash are required' USING ERRCODE = '22023';
  END IF;

  SELECT id INTO v_event_id
  FROM public.payment_events
  WHERE provider = 'mercadopago' AND dedupe_key = btrim(p_dedupe_key)
  FOR UPDATE;
  IF FOUND THEN
    RETURN QUERY SELECT v_event_id, true;
    RETURN;
  END IF;

  INSERT INTO public.payment_events (
    provider, dedupe_key, request_id, provider_event_id, provider_payment_id,
    order_id, external_reference, signature_valid, payload_hash, provider_status,
    status, raw_payload
  ) VALUES (
    'mercadopago', btrim(p_dedupe_key), NULLIF(btrim(COALESCE(p_request_id, '')), ''),
    NULLIF(btrim(COALESCE(p_provider_event_id, '')), ''), btrim(p_provider_payment_id),
    p_order_id, p_external_reference, true, btrim(p_payload_hash),
    NULLIF(btrim(COALESCE(p_provider_status, '')), ''), 'received', '{}'::jsonb
  ) RETURNING id INTO v_event_id;

  RETURN QUERY SELECT v_event_id, false;
END;
$$;

CREATE OR REPLACE FUNCTION public.apply_mercadopago_payment_transition(
  p_event_id uuid,
  p_order_id uuid,
  p_payment_id text,
  p_payment_status text,
  p_amount numeric,
  p_currency text,
  p_external_reference text,
  p_preference_id text
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_order public.orders%ROWTYPE;
  v_event public.payment_events%ROWTYPE;
  v_consumed boolean;
  v_status text := lower(btrim(COALESCE(p_payment_status, '')));
BEGIN
  SELECT * INTO v_event FROM public.payment_events WHERE id = p_event_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'payment event not found' USING ERRCODE = '22023'; END IF;
  IF v_event.status IN ('processed', 'duplicate', 'ignored') THEN RETURN 'duplicate'; END IF;

  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'order not found' USING ERRCODE = '22023'; END IF;

  IF v_order.external_reference IS DISTINCT FROM p_external_reference THEN
    UPDATE public.payment_events SET status = 'failed', error_code = 'REFERENCE_MISMATCH', processed_at = now() WHERE id = p_event_id;
    UPDATE public.orders SET order_status = 'on_hold', review_required = true, review_reason = 'payment_reference_mismatch', updated_at = now() WHERE id = p_order_id;
    RETURN 'review_reference_mismatch';
  END IF;
  IF v_order.mercadopago_preference_id IS DISTINCT FROM p_preference_id THEN
    UPDATE public.payment_events SET status = 'failed', error_code = 'PREFERENCE_MISMATCH', processed_at = now() WHERE id = p_event_id;
    UPDATE public.orders SET order_status = 'on_hold', review_required = true, review_reason = 'payment_reference_mismatch', updated_at = now() WHERE id = p_order_id;
    RETURN 'review_preference_mismatch';
  END IF;
  IF round(COALESCE(p_amount, -1), 2) <> round(v_order.total_amount, 2) THEN
    UPDATE public.payment_events SET status = 'failed', error_code = 'AMOUNT_MISMATCH', processed_at = now() WHERE id = p_event_id;
    UPDATE public.orders SET order_status = 'on_hold', review_required = true, review_reason = 'payment_amount_mismatch', updated_at = now() WHERE id = p_order_id;
    RETURN 'review_amount_mismatch';
  END IF;
  IF upper(COALESCE(p_currency, '')) <> 'ARS' OR v_order.currency <> 'ARS' THEN
    UPDATE public.payment_events SET status = 'failed', error_code = 'CURRENCY_MISMATCH', processed_at = now() WHERE id = p_event_id;
    UPDATE public.orders SET order_status = 'on_hold', review_required = true, review_reason = 'payment_currency_mismatch', updated_at = now() WHERE id = p_order_id;
    RETURN 'review_currency_mismatch';
  END IF;

  IF v_order.payment_status = 'approved' AND v_status NOT IN ('refunded', 'charged_back') THEN
    UPDATE public.payment_events SET status = 'ignored', processed_at = now() WHERE id = p_event_id;
    RETURN 'ignored_out_of_order';
  END IF;

  CASE v_status
    WHEN 'approved' THEN
      v_consumed := public.consume_order_reservation(p_order_id, btrim(p_payment_id));
      IF v_consumed THEN
        UPDATE public.payment_events SET status = 'processed', processed_at = now() WHERE id = p_event_id;
        RETURN 'approved';
      END IF;
      UPDATE public.orders
      SET refund_required = true, refund_required_at = now(),
          refund_required_reason = 'late approved payment without available stock',
          review_required = true, review_reason = 'late_approved_payment_no_stock',
          order_status = 'on_hold', payment_status = 'approved',
          mercadopago_payment_id = btrim(p_payment_id), paid_at = COALESCE(paid_at, now()), updated_at = now()
      WHERE id = p_order_id;
      UPDATE public.payment_events SET status = 'processed', processed_at = now() WHERE id = p_event_id;
      RETURN 'review_refund_required';
    WHEN 'pending', 'in_process' THEN
      UPDATE public.orders SET payment_status = 'pending', order_status = 'pending_payment', updated_at = now()
      WHERE id = p_order_id AND payment_status <> 'approved';
    WHEN 'rejected' THEN
      PERFORM public.release_order_reservation(p_order_id, 'failed');
      UPDATE public.orders SET payment_status = 'rejected', updated_at = now() WHERE id = p_order_id AND payment_status <> 'approved';
    WHEN 'cancelled' THEN
      PERFORM public.release_order_reservation(p_order_id, 'cancelled');
    WHEN 'refunded' THEN
      UPDATE public.orders
      SET payment_status = 'refunded', order_status = 'refunded', updated_at = now()
      WHERE id = p_order_id;
    WHEN 'charged_back' THEN
      UPDATE public.orders
      SET payment_status = 'charged_back', order_status = 'on_hold', review_required = true,
          review_reason = 'provider_dispute', refund_required = true,
          refund_required_at = COALESCE(refund_required_at, now()),
          refund_required_reason = COALESCE(refund_required_reason, 'provider chargeback'), updated_at = now()
      WHERE id = p_order_id;
    ELSE
      UPDATE public.payment_events SET status = 'ignored', error_code = 'UNSUPPORTED_STATUS', processed_at = now() WHERE id = p_event_id;
      RETURN 'ignored_status';
  END CASE;

  UPDATE public.payment_events SET status = 'processed', processed_at = now() WHERE id = p_event_id;
  RETURN v_status;
END;
$$;

REVOKE ALL ON FUNCTION public.get_checkout_shipping_amount(public.delivery_method) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.commerce_rate_limit_windows FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.create_checkout_order_v2(uuid, text, uuid, text, text, text, public.delivery_method, jsonb, jsonb, text, integer) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.attach_mercadopago_preference(uuid, text, text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.record_mercadopago_payment_event(text, text, text, text, uuid, text, text, text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.apply_mercadopago_payment_transition(uuid, uuid, text, text, numeric, text, text, text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.consume_commerce_rate_limit(text, text[]) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.purge_commerce_rate_limit_windows() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.claim_mercadopago_preference_creation(uuid, uuid, integer) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.complete_mercadopago_preference_creation(uuid, uuid, text, text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fail_mercadopago_preference_creation(uuid, uuid, text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.reconcile_mercadopago_preference_creation(uuid, boolean, text, text) FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.get_checkout_shipping_amount(public.delivery_method) TO service_role;
GRANT EXECUTE ON FUNCTION public.create_checkout_order_v2(uuid, text, uuid, text, text, text, public.delivery_method, jsonb, jsonb, text, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.attach_mercadopago_preference(uuid, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_mercadopago_payment_event(text, text, text, text, uuid, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.apply_mercadopago_payment_transition(uuid, uuid, text, text, numeric, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.consume_commerce_rate_limit(text, text[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.purge_commerce_rate_limit_windows() TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_mercadopago_preference_creation(uuid, uuid, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_mercadopago_preference_creation(uuid, uuid, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.fail_mercadopago_preference_creation(uuid, uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.reconcile_mercadopago_preference_creation(uuid, boolean, text, text) TO service_role;

COMMIT;
