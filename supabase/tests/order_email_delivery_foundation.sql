\set ON_ERROR_STOP on

-- FASE 7E-B1: order_email_events + claim_order_email_delivery /
-- mark_order_email_sent / mark_order_email_failed.
--
-- Concurrency note: like every other SQL test in this suite (see
-- phase3m_atomic_payment_local.sql), this script is a single session and
-- cannot spawn two truly simultaneous connections. "Concurrent claim" is
-- therefore verified the same way adminBoundaryConcurrency.test.ts verifies
-- a concurrent edit race in TypeScript: two callers, sequenced so the second
-- observes exactly the state a real concurrent caller would (a fresh,
-- un-terminated 'processing' row) -- not wall-clock-simultaneous, but the
-- same decision point. A true two-connection race was additionally checked
-- by hand against the sandbox used to build this migration (two parallel
-- `docker exec psql` processes calling claim_order_email_delivery for the
-- same order at the same time); only one returned 'claimed'.

BEGIN;

CREATE TEMP TABLE email_results (
  test_name text PRIMARY KEY,
  ok boolean NOT NULL,
  detail text NOT NULL
);

CREATE OR REPLACE FUNCTION pg_temp.make_product(p_name text, p_stock integer DEFAULT 2)
RETURNS uuid
LANGUAGE plpgsql
AS $$
DECLARE v_id uuid := gen_random_uuid();
BEGIN
  INSERT INTO public.products (
    id, name, description, category, price, is_featured, display_order,
    is_active, sku, slug, currency, track_stock, allow_backorder,
    stock_on_hand, low_stock_threshold
  ) VALUES (
    v_id, p_name, 'Email fixture', 'test', 100, false, 0,
    true, 'EM-' || replace(v_id::text, '-', ''), lower(replace(p_name, ' ', '-')) || '-' || left(v_id::text, 8),
    'ARS', true, false, p_stock, 0
  );
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION pg_temp.make_order(p_product_ids uuid[], p_label text)
RETURNS uuid
LANGUAGE plpgsql
AS $$
DECLARE
  v_order uuid;
  v_items jsonb;
BEGIN
  SELECT jsonb_agg(jsonb_build_object('productId', product_id, 'quantity', 1) ORDER BY ordinal)
  INTO v_items
  FROM unnest(p_product_ids) WITH ORDINALITY AS item(product_id, ordinal);

  SELECT order_id INTO v_order
  FROM public.create_checkout_order_v2(
    gen_random_uuid(), 'email-' || p_label || '-' || gen_random_uuid()::text,
    NULL, p_label || '@example.test', p_label, NULL, 'pickup', '{}'::jsonb,
    v_items, 'email-token-' || p_label, 15
  );
  PERFORM public.attach_mercadopago_preference(
    v_order, 'pref-' || p_label, 'https://example.invalid/' || p_label
  );
  RETURN v_order;
END;
$$;

DO $$
DECLARE
  v_product uuid;
  v_order_a uuid;
  v_order_b uuid;
  v_order_c uuid;
  v_order_d uuid;
  v_claim text;
  v_event_a uuid;
  v_event_b uuid;
BEGIN
  -- 1. First claim on a fresh order is 'claimed', and creates exactly one row.
  v_product := pg_temp.make_product('email claim fresh');
  v_order_a := pg_temp.make_order(ARRAY[v_product], 'claim-fresh');
  SELECT claim, event_id INTO v_claim, v_event_a FROM public.claim_order_email_delivery(v_order_a, 'purchase_confirmation');
  IF v_claim <> 'claimed' THEN RAISE EXCEPTION 'first claim was not claimed: %', v_claim; END IF;
  IF (SELECT count(*) FROM public.order_email_events WHERE order_id = v_order_a) <> 1 THEN
    RAISE EXCEPTION 'first claim did not create exactly one canonical row';
  END IF;
  IF (SELECT status FROM public.order_email_events WHERE id = v_event_a) <> 'processing' THEN
    RAISE EXCEPTION 'claimed row is not processing';
  END IF;
  INSERT INTO email_results VALUES ('first claim on a fresh order is claimed', true, 'exactly one row, status processing');

  -- 2. A second claim while the first is still "processing" (fresh
  --    attempted_at) must never also be told to send.
  SELECT claim INTO v_claim FROM public.claim_order_email_delivery(v_order_a, 'purchase_confirmation');
  IF v_claim <> 'already_processing' THEN RAISE EXCEPTION 'second concurrent claim was not blocked: %', v_claim; END IF;
  IF (SELECT count(*) FROM public.order_email_events WHERE order_id = v_order_a) <> 1 THEN
    RAISE EXCEPTION 'second concurrent claim created a duplicate row';
  END IF;
  INSERT INTO email_results VALUES ('concurrent second claim gets already_processing, never a duplicate send', true, 'one row, no new send authorized');

  -- 3. mark_order_email_sent transitions processing -> sent, sets sent_at.
  PERFORM public.mark_order_email_sent(v_order_a, 'purchase_confirmation', 'provider-msg-123');
  IF NOT (SELECT status = 'sent' AND sent_at IS NOT NULL AND provider_message_id = 'provider-msg-123' AND error_code IS NULL
          FROM public.order_email_events WHERE order_id = v_order_a) THEN
    RAISE EXCEPTION 'mark_order_email_sent did not persist sent state correctly';
  END IF;
  INSERT INTO email_results VALUES ('mark_order_email_sent records sent_at and provider_message_id', true, 'status=sent');

  -- 4. Once sent, a later claim is always already_sent -- never reclaimable.
  SELECT claim INTO v_claim FROM public.claim_order_email_delivery(v_order_a, 'purchase_confirmation');
  IF v_claim <> 'already_sent' THEN RAISE EXCEPTION 'a sent email was reclaimed: %', v_claim; END IF;
  INSERT INTO email_results VALUES ('sent is terminal: never reclaimed automatically', true, 'already_sent');

  -- 5. mark_order_email_sent can never be called again on a terminal row
  --    (the transition guard, not just caller discipline).
  BEGIN
    PERFORM public.mark_order_email_sent(v_order_a, 'purchase_confirmation', 'second-attempt');
    RAISE EXCEPTION 'mark_order_email_sent allowed a double-send on an already-sent row';
  EXCEPTION WHEN SQLSTATE '22023' THEN
    NULL;
  END;
  INSERT INTO email_results VALUES ('mark_order_email_sent rejects a non-processing row at the data layer', true, 'invalid_transition raised');

  -- 6. A failed attempt is retryable: claim -> failed -> claim again succeeds.
  v_product := pg_temp.make_product('email claim retry');
  v_order_b := pg_temp.make_order(ARRAY[v_product], 'claim-retry');
  PERFORM public.claim_order_email_delivery(v_order_b, 'purchase_confirmation');
  PERFORM public.mark_order_email_failed(v_order_b, 'purchase_confirmation', 'provider_unavailable');
  IF NOT (SELECT status = 'failed' AND error_code = 'provider_unavailable' AND sent_at IS NULL
          FROM public.order_email_events WHERE order_id = v_order_b) THEN
    RAISE EXCEPTION 'mark_order_email_failed did not persist failed state correctly';
  END IF;
  SELECT claim, event_id INTO v_claim, v_event_b FROM public.claim_order_email_delivery(v_order_b, 'purchase_confirmation');
  IF v_claim <> 'claimed' THEN RAISE EXCEPTION 'a failed attempt could not be retried: %', v_claim; END IF;
  IF (SELECT count(*) FROM public.order_email_events WHERE order_id = v_order_b) <> 1 THEN
    RAISE EXCEPTION 'retry created a second row instead of reusing the canonical one';
  END IF;
  IF NOT (SELECT error_code IS NULL FROM public.order_email_events WHERE id = v_event_b) THEN
    RAISE EXCEPTION 'retried claim did not clear the previous error_code';
  END IF;
  INSERT INTO email_results VALUES ('failed is retryable: a later claim reclaims the same canonical row', true, 'claimed again, error_code cleared');

  -- 7. mark_order_email_failed also rejects a non-processing row.
  PERFORM public.mark_order_email_sent(v_order_b, 'purchase_confirmation', 'provider-msg-456');
  BEGIN
    PERFORM public.mark_order_email_failed(v_order_b, 'purchase_confirmation', 'provider_rejected');
    RAISE EXCEPTION 'mark_order_email_failed allowed marking an already-sent row as failed';
  EXCEPTION WHEN SQLSTATE '22023' THEN
    NULL;
  END;
  INSERT INTO email_results VALUES ('mark_order_email_failed rejects a non-processing row at the data layer', true, 'invalid_transition raised');

  -- 8. A stale 'processing' row (abandoned attempt) may be reclaimed.
  v_product := pg_temp.make_product('email claim stale');
  v_order_c := pg_temp.make_order(ARRAY[v_product], 'claim-stale');
  PERFORM public.claim_order_email_delivery(v_order_c, 'purchase_confirmation');
  UPDATE public.order_email_events SET attempted_at = now() - interval '10 minutes' WHERE order_id = v_order_c;
  SELECT claim INTO v_claim FROM public.claim_order_email_delivery(v_order_c, 'purchase_confirmation');
  IF v_claim <> 'claimed' THEN RAISE EXCEPTION 'a stale abandoned processing row could not be reclaimed: %', v_claim; END IF;
  INSERT INTO email_results VALUES ('a stale (abandoned) processing row can be reclaimed', true, 'claimed again past the staleness window');

  -- 9. provider_message_id is genuinely nullable before success.
  v_product := pg_temp.make_product('email no message id');
  v_order_d := pg_temp.make_order(ARRAY[v_product], 'no-message-id');
  PERFORM public.claim_order_email_delivery(v_order_d, 'purchase_confirmation');
  IF NOT (SELECT provider_message_id IS NULL FROM public.order_email_events WHERE order_id = v_order_d) THEN
    RAISE EXCEPTION 'provider_message_id was not null before a successful send';
  END IF;
  INSERT INTO email_results VALUES ('provider_message_id is null before success', true, 'nullable column confirmed');

  -- 10. email_type/status CHECK constraints reject anything outside the model.
  BEGIN
    INSERT INTO public.order_email_events (order_id, email_type, status, attempted_at) VALUES (v_order_d, 'shipping_notice', 'processing', now());
    RAISE EXCEPTION 'an unsupported email_type was accepted';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;
  BEGIN
    UPDATE public.order_email_events SET status = 'pending' WHERE order_id = v_order_d;
    RAISE EXCEPTION 'an unsupported status was accepted';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;
  INSERT INTO email_results VALUES ('email_type and status CHECK constraints hold', true, 'unsupported values rejected');

  -- 11. The unique index enforces one canonical row per (order, email_type)
  --     even against a direct INSERT bypassing the RPC.
  BEGIN
    INSERT INTO public.order_email_events (order_id, email_type, status, attempted_at) VALUES (v_order_d, 'purchase_confirmation', 'processing', now());
    RAISE EXCEPTION 'a second row for the same (order, email_type) was accepted';
  EXCEPTION WHEN unique_violation THEN
    NULL;
  END;
  INSERT INTO email_results VALUES ('UNIQUE(order_id, email_type) holds even against a direct INSERT', true, 'unique_violation raised');

  -- 12. The FK to orders holds.
  BEGIN
    PERFORM public.claim_order_email_delivery('00000000-0000-4000-8000-000000000000'::uuid, 'purchase_confirmation');
    RAISE EXCEPTION 'a claim for a nonexistent order was accepted';
  EXCEPTION WHEN foreign_key_violation THEN
    NULL;
  END;
  INSERT INTO email_results VALUES ('FK to orders(id) holds', true, 'foreign_key_violation raised for a nonexistent order');

  -- 13. error_code format is validated by mark_order_email_failed itself.
  v_product := pg_temp.make_product('email bad error code');
  v_order_d := pg_temp.make_order(ARRAY[v_product], 'bad-error-code');
  PERFORM public.claim_order_email_delivery(v_order_d, 'purchase_confirmation');
  BEGIN
    PERFORM public.mark_order_email_failed(v_order_d, 'purchase_confirmation', 'Not A Valid Code!');
    RAISE EXCEPTION 'an unsanitized error_code was accepted';
  EXCEPTION WHEN SQLSTATE '22023' THEN
    NULL;
  END;
  INSERT INTO email_results VALUES ('mark_order_email_failed validates error_code format', true, 'invalid_error_code raised');

  -- 14. Grants: service_role only, anon/authenticated reach nothing.
  IF has_function_privilege('anon', 'public.claim_order_email_delivery(uuid,text)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.claim_order_email_delivery(uuid,text)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.claim_order_email_delivery(uuid,text)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.mark_order_email_sent(uuid,text,text)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.mark_order_email_sent(uuid,text,text)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.mark_order_email_sent(uuid,text,text)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.mark_order_email_failed(uuid,text,text)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.mark_order_email_failed(uuid,text,text)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.mark_order_email_failed(uuid,text,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'RPC privilege boundary is wrong: must be service_role-only';
  END IF;
  INSERT INTO email_results VALUES ('claim/mark RPCs are service_role-only', true, 'anon and authenticated have no EXECUTE');

  IF has_table_privilege('anon', 'public.order_email_events', 'SELECT')
     OR has_table_privilege('anon', 'public.order_email_events', 'INSERT')
     OR has_table_privilege('authenticated', 'public.order_email_events', 'SELECT')
     OR has_table_privilege('authenticated', 'public.order_email_events', 'INSERT')
     OR NOT has_table_privilege('service_role', 'public.order_email_events', 'SELECT')
     OR NOT has_table_privilege('service_role', 'public.order_email_events', 'INSERT') THEN
    RAISE EXCEPTION 'table grants are wrong: must be service_role-only';
  END IF;
  INSERT INTO email_results VALUES ('order_email_events table grants are service_role-only', true, 'anon and authenticated have no table privilege');

  -- 15. RLS is enabled+forced with zero policies -- even if a grant existed,
  --     authenticated could read/write nothing through it.
  IF NOT (SELECT relrowsecurity AND relforcerowsecurity FROM pg_class WHERE oid = 'public.order_email_events'::regclass) THEN
    RAISE EXCEPTION 'RLS is not enabled+forced on order_email_events';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policy WHERE polrelid = 'public.order_email_events'::regclass) THEN
    RAISE EXCEPTION 'order_email_events has a policy; it should have none (service_role bypasses RLS entirely)';
  END IF;
  INSERT INTO email_results VALUES ('RLS enabled+forced with zero policies', true, 'no client role reaches this table via PostgREST');
END;
$$;

SELECT test_name, ok, detail FROM email_results ORDER BY test_name;

ROLLBACK;
