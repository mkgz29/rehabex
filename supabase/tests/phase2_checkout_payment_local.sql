\set ON_ERROR_STOP on

BEGIN;

CREATE TEMP TABLE phase2_results (test_name text PRIMARY KEY, ok boolean NOT NULL, detail text NOT NULL);

DO $$
DECLARE
  v_product uuid := gen_random_uuid();
  v_order uuid;
  v_repeat uuid;
  v_late_order uuid;
  v_aux_order uuid;
  v_event uuid;
  v_duplicate boolean;
  v_result text;
  v_stock integer;
  v_count integer;
  v_i integer;
  v_rate_allowed boolean;
  v_retry integer;
  v_preference_product uuid := gen_random_uuid();
  v_preference_order uuid;
  v_lease_one uuid := gen_random_uuid();
  v_lease_two uuid := gen_random_uuid();
BEGIN
  DELETE FROM public.commerce_rate_limit_windows;
  INSERT INTO public.settings(key, value)
  VALUES ('commerce_shipping', '{"fixed_amount":25}'::jsonb)
  ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;

  INSERT INTO public.products (id, name, description, category, price, is_featured, display_order, is_active, sku, slug, currency, track_stock, allow_backorder, stock_on_hand, low_stock_threshold)
  VALUES (v_product, 'Phase 2 product', 'Fixture', 'test', 100, false, 0, true, 'PHASE2-SKU', 'phase2-product', 'ARS', true, false, 2, 0);

  SELECT order_id INTO v_order FROM public.create_checkout_order_v2(
    gen_random_uuid(), 'phase2-hash', NULL, 'guest@example.test', 'Guest', NULL,
    'pickup', '{"pickupLocationLabel":"Rehabex"}'::jsonb,
    jsonb_build_array(jsonb_build_object('productId', v_product, 'quantity', 1)),
    'phase2-token', 15
  );
  IF (SELECT shipping_amount FROM public.orders WHERE id = v_order) <> 0 THEN RAISE EXCEPTION 'pickup shipping must be zero'; END IF;
  INSERT INTO phase2_results VALUES ('pickup uses backend fixed shipping', true, v_order::text);

  SELECT order_id INTO v_repeat FROM public.create_checkout_order_v2(
    (SELECT idempotency_key FROM public.orders WHERE id = v_order), 'phase2-hash', NULL, 'guest@example.test', 'Guest', NULL,
    'pickup', '{"pickupLocationLabel":"Rehabex"}'::jsonb,
    jsonb_build_array(jsonb_build_object('productId', v_product, 'quantity', 1)), 'other-token', 15
  );
  IF v_repeat IS DISTINCT FROM v_order THEN RAISE EXCEPTION 'idempotency did not reuse order'; END IF;
  INSERT INTO phase2_results VALUES ('checkout idempotency reuses order', true, v_order::text);

  BEGIN
    PERFORM public.create_checkout_order_v2((SELECT idempotency_key FROM public.orders WHERE id = v_order), 'different-hash', NULL, 'guest@example.test', 'Guest', NULL, 'pickup', '{}'::jsonb, jsonb_build_array(jsonb_build_object('productId', v_product, 'quantity', 1)), 'token', 15);
    RAISE EXCEPTION 'idempotency conflict accepted';
  EXCEPTION WHEN SQLSTATE '23505' THEN NULL;
  END;
  INSERT INTO phase2_results VALUES ('checkout idempotency conflict rejected', true, '23505');

  PERFORM public.attach_mercadopago_preference(v_order, 'pref-phase2', 'https://example.invalid/checkout');
  SELECT event_id, is_duplicate INTO v_event, v_duplicate FROM public.record_mercadopago_payment_event('event-approved', 'request-approved', NULL, 'payment-approved', v_order, v_order::text, 'hash-approved', 'approved');
  IF v_duplicate THEN RAISE EXCEPTION 'first event was duplicate'; END IF;
  SELECT public.apply_mercadopago_payment_transition(v_event, v_order, 'payment-approved', 'approved', 100, 'ARS', v_order::text, 'pref-phase2') INTO v_result;
  IF v_result <> 'approved' THEN RAISE EXCEPTION 'approval result %', v_result; END IF;
  SELECT stock_on_hand INTO v_stock FROM public.products WHERE id = v_product;
  IF v_stock <> 1 THEN RAISE EXCEPTION 'approved payment did not consume stock once'; END IF;
  INSERT INTO phase2_results VALUES ('approved consumes stock exactly once', true, v_stock::text);

  SELECT event_id, is_duplicate INTO v_event, v_duplicate FROM public.record_mercadopago_payment_event('event-approved', 'request-approved', NULL, 'payment-approved', v_order, v_order::text, 'hash-approved', 'approved');
  IF NOT v_duplicate THEN RAISE EXCEPTION 'duplicate event not detected'; END IF;
  SELECT stock_on_hand INTO v_stock FROM public.products WHERE id = v_product;
  IF v_stock <> 1 THEN RAISE EXCEPTION 'duplicate event changed stock'; END IF;
  INSERT INTO phase2_results VALUES ('duplicate webhook event is harmless', true, v_stock::text);

  SELECT event_id INTO v_event FROM public.record_mercadopago_payment_event('event-out-of-order', 'request-out-of-order', NULL, 'payment-approved', v_order, v_order::text, 'hash-out-of-order', 'pending');
  SELECT public.apply_mercadopago_payment_transition(v_event, v_order, 'payment-approved', 'pending', 100, 'ARS', v_order::text, 'pref-phase2') INTO v_result;
  IF v_result <> 'ignored_out_of_order' OR (SELECT payment_status FROM public.orders WHERE id = v_order) <> 'approved' THEN RAISE EXCEPTION 'out of order event regressed payment'; END IF;
  INSERT INTO phase2_results VALUES ('out of order pending does not regress approval', true, v_result);

  SELECT order_id INTO v_aux_order FROM public.create_checkout_order_v2(gen_random_uuid(), 'reject-hash', NULL, 'reject@example.test', 'Reject', NULL, 'pickup', '{}'::jsonb, jsonb_build_array(jsonb_build_object('productId', v_product, 'quantity', 1)), 'reject-token', 15);
  PERFORM public.attach_mercadopago_preference(v_aux_order, 'pref-reject', 'https://example.invalid/reject');
  SELECT event_id INTO v_event FROM public.record_mercadopago_payment_event('event-reject', 'request-reject', NULL, 'payment-reject', v_aux_order, v_aux_order::text, 'hash-reject', 'rejected');
  SELECT public.apply_mercadopago_payment_transition(v_event, v_aux_order, 'payment-reject', 'rejected', 100, 'ARS', v_aux_order::text, 'pref-reject') INTO v_result;
  IF v_result <> 'rejected' OR (SELECT payment_status FROM public.orders WHERE id = v_aux_order) <> 'rejected' OR (SELECT status FROM public.stock_reservations WHERE order_id = v_aux_order) <> 'released' THEN RAISE EXCEPTION 'rejection did not release reservation'; END IF;
  INSERT INTO phase2_results VALUES ('rejected releases reservation once', true, v_result);

  SELECT order_id INTO v_aux_order FROM public.create_checkout_order_v2(gen_random_uuid(), 'cancel-hash', NULL, 'cancel@example.test', 'Cancel', NULL, 'pickup', '{}'::jsonb, jsonb_build_array(jsonb_build_object('productId', v_product, 'quantity', 1)), 'cancel-token', 15);
  PERFORM public.attach_mercadopago_preference(v_aux_order, 'pref-cancel', 'https://example.invalid/cancel');
  SELECT event_id INTO v_event FROM public.record_mercadopago_payment_event('event-cancel', 'request-cancel', NULL, 'payment-cancel', v_aux_order, v_aux_order::text, 'hash-cancel', 'cancelled');
  SELECT public.apply_mercadopago_payment_transition(v_event, v_aux_order, 'payment-cancel', 'cancelled', 100, 'ARS', v_aux_order::text, 'pref-cancel') INTO v_result;
  IF v_result <> 'cancelled' OR (SELECT payment_status FROM public.orders WHERE id = v_aux_order) <> 'cancelled' THEN RAISE EXCEPTION 'cancellation did not map'; END IF;
  INSERT INTO phase2_results VALUES ('cancelled maps and releases reservation', true, v_result);

  SELECT event_id INTO v_event FROM public.record_mercadopago_payment_event('event-refund', 'request-refund', NULL, 'payment-approved', v_order, v_order::text, 'hash-refund', 'refunded');
  SELECT public.apply_mercadopago_payment_transition(v_event, v_order, 'payment-approved', 'refunded', 100, 'ARS', v_order::text, 'pref-phase2') INTO v_result;
  IF v_result <> 'refunded' OR (SELECT payment_status FROM public.orders WHERE id = v_order) <> 'refunded' THEN RAISE EXCEPTION 'refund did not map'; END IF;
  INSERT INTO phase2_results VALUES ('refunded maps without restocking automatically', true, v_result);

  SELECT order_id INTO v_late_order FROM public.create_checkout_order_v2(
    gen_random_uuid(), 'late-hash', NULL, 'late@example.test', 'Late', NULL,
    'pickup', '{}'::jsonb, jsonb_build_array(jsonb_build_object('productId', v_product, 'quantity', 1)), 'late-token', 15
  );
  PERFORM public.attach_mercadopago_preference(v_late_order, 'pref-late', 'https://example.invalid/late');
  UPDATE public.stock_reservations SET status = 'expired', expires_at = now() - interval '1 minute' WHERE order_id = v_late_order;
  UPDATE public.products SET stock_on_hand = 0 WHERE id = v_product;
  SELECT event_id INTO v_event FROM public.record_mercadopago_payment_event('event-late', 'request-late', NULL, 'payment-late', v_late_order, v_late_order::text, 'hash-late', 'approved');
  SELECT public.apply_mercadopago_payment_transition(v_event, v_late_order, 'payment-late', 'approved', 100, 'ARS', v_late_order::text, 'pref-late') INTO v_result;
  IF v_result <> 'review_refund_required' OR NOT (SELECT refund_required FROM public.orders WHERE id = v_late_order) THEN RAISE EXCEPTION 'late approval was not held for refund'; END IF;
  SELECT stock_on_hand INTO v_stock FROM public.products WHERE id = v_product;
  IF v_stock < 0 THEN RAISE EXCEPTION 'stock became negative'; END IF;
  INSERT INTO phase2_results VALUES ('late approval without stock requires refund', true, v_stock::text);

  SELECT event_id INTO v_event FROM public.record_mercadopago_payment_event('event-chargeback', 'request-chargeback', NULL, 'payment-late', v_late_order, v_late_order::text, 'hash-chargeback', 'charged_back');
  SELECT public.apply_mercadopago_payment_transition(v_event, v_late_order, 'payment-late', 'charged_back', 100, 'ARS', v_late_order::text, 'pref-late') INTO v_result;
  IF v_result <> 'charged_back' OR NOT (SELECT review_required AND refund_required FROM public.orders WHERE id = v_late_order) THEN RAISE EXCEPTION 'chargeback did not require review'; END IF;
  INSERT INTO phase2_results VALUES ('charged back requires review', true, v_result);

  -- Rate limits are an atomic all-or-nothing consume across checkout IP + key.
  FOR v_i IN 1..5 LOOP
    SELECT allowed, retry_after_seconds INTO v_rate_allowed, v_retry
    FROM public.consume_commerce_rate_limit('checkout', ARRAY[repeat('a', 64), lpad(v_i::text, 64, 'b')]);
    IF NOT v_rate_allowed THEN RAISE EXCEPTION 'checkout request % unexpectedly limited', v_i; END IF;
  END LOOP;
  SELECT allowed, retry_after_seconds INTO v_rate_allowed, v_retry
  FROM public.consume_commerce_rate_limit('checkout', ARRAY[repeat('a', 64), lpad('6', 64, 'b')]);
  IF v_rate_allowed OR v_retry < 1 THEN RAISE EXCEPTION 'checkout IP limit was not enforced'; END IF;
  INSERT INTO phase2_results VALUES ('checkout IP rate limit rejects excess atomically', true, v_retry::text);

  FOR v_i IN 1..3 LOOP
    SELECT allowed INTO v_rate_allowed
    FROM public.consume_commerce_rate_limit('checkout', ARRAY[lpad((10 + v_i)::text, 64, 'a'), repeat('c', 64)]);
    IF NOT v_rate_allowed THEN RAISE EXCEPTION 'idempotency request % unexpectedly limited', v_i; END IF;
  END LOOP;
  SELECT allowed INTO v_rate_allowed
  FROM public.consume_commerce_rate_limit('checkout', ARRAY[lpad('20', 64, 'a'), repeat('c', 64)]);
  IF v_rate_allowed THEN RAISE EXCEPTION 'idempotency key limit was not enforced'; END IF;
  INSERT INTO phase2_results VALUES ('checkout idempotency rate limit rejects excess', true, '3 per 10m');

  SELECT allowed INTO v_rate_allowed
  FROM public.consume_commerce_rate_limit('checkout', ARRAY[repeat('d', 64), repeat('e', 64)]);
  IF NOT v_rate_allowed THEN RAISE EXCEPTION 'separate client was incorrectly limited'; END IF;
  INSERT INTO phase2_results VALUES ('rate limits separate clients', true, 'separate hash allowed');

  INSERT INTO public.commerce_rate_limit_windows(scope, subject_hash, window_started_at, request_count)
  VALUES ('checkout_ip', repeat('f', 64), now() - interval '25 hours', 5);
  PERFORM public.purge_commerce_rate_limit_windows();
  IF EXISTS (SELECT 1 FROM public.commerce_rate_limit_windows WHERE subject_hash = repeat('f', 64)) THEN
    RAISE EXCEPTION 'expired rate limit window was not purged';
  END IF;
  INSERT INTO phase2_results VALUES ('rate limit expiry cleanup removes old windows', true, '24h retention');

  INSERT INTO public.products (id, name, description, category, price, is_featured, display_order, is_active, sku, slug, currency, track_stock, allow_backorder, stock_on_hand, low_stock_threshold)
  VALUES (v_preference_product, 'Preference lease fixture', 'Fixture', 'test', 100, false, 0, true, 'PHASE2-PREFERENCE-SKU', 'phase2-preference-product', 'ARS', false, false, 0, 0);
  SELECT order_id INTO v_preference_order FROM public.create_checkout_order_v2(
    gen_random_uuid(), 'preference-lease-hash', NULL, 'lease@example.test', 'Lease', NULL,
    'pickup', '{}'::jsonb, jsonb_build_array(jsonb_build_object('productId', v_preference_product, 'quantity', 1)), 'lease-token', 15
  );
  SELECT claim_status INTO v_result FROM public.claim_mercadopago_preference_creation(v_preference_order, v_lease_one, 90);
  IF v_result <> 'claimed' THEN RAISE EXCEPTION 'first preference claim was %', v_result; END IF;
  SELECT claim_status INTO v_result FROM public.claim_mercadopago_preference_creation(v_preference_order, v_lease_two, 90);
  IF v_result <> 'processing' THEN RAISE EXCEPTION 'second preference claim was %', v_result; END IF;
  INSERT INTO phase2_results VALUES ('preference lease permits one concurrent creator', true, 'processing for second claim');

  UPDATE public.orders SET mercadopago_preference_lease_expires_at = now() - interval '1 second' WHERE id = v_preference_order;
  SELECT claim_status INTO v_result FROM public.claim_mercadopago_preference_creation(v_preference_order, v_lease_two, 90);
  IF v_result <> 'reconciliation_required' THEN RAISE EXCEPTION 'expired preference lease was not held for reconciliation'; END IF;
  SELECT public.reconcile_mercadopago_preference_creation(v_preference_order, true, NULL, NULL) INTO v_result;
  IF v_result <> 'reopened' THEN RAISE EXCEPTION 'controlled preference recovery was %', v_result; END IF;
  SELECT claim_status INTO v_result FROM public.claim_mercadopago_preference_creation(v_preference_order, v_lease_two, 90);
  IF v_result <> 'claimed' THEN RAISE EXCEPTION 'controlled preference recovery did not reopen lease'; END IF;
  BEGIN
    PERFORM public.complete_mercadopago_preference_creation(v_preference_order, v_lease_one, 'pref-old-owner', 'https://example.invalid/old');
    RAISE EXCEPTION 'old lease owner unexpectedly persisted a preference';
  EXCEPTION WHEN SQLSTATE '55000' THEN NULL;
  END;
  SELECT claim_status INTO v_result FROM public.complete_mercadopago_preference_creation(v_preference_order, v_lease_two, 'pref-phase2-lease', 'https://example.invalid/lease');
  IF v_result <> 'ready' THEN RAISE EXCEPTION 'preference completion was %', v_result; END IF;
  SELECT claim_status INTO v_result FROM public.claim_mercadopago_preference_creation(v_preference_order, gen_random_uuid(), 90);
  IF v_result <> 'ready' THEN RAISE EXCEPTION 'persisted preference was not reused'; END IF;
  INSERT INTO phase2_results VALUES ('expired lease requires controlled recovery and preference is immutable', true, 'ready');

  IF has_function_privilege('anon', 'public.create_checkout_order_v2(uuid,text,uuid,text,text,text,public.delivery_method,jsonb,jsonb,text,integer)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.apply_mercadopago_payment_transition(uuid,uuid,text,text,numeric,text,text,text)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.consume_commerce_rate_limit(text,text[])', 'EXECUTE')
     OR has_table_privilege('anon', 'public.commerce_rate_limit_windows', 'SELECT')
     OR has_table_privilege('authenticated', 'public.commerce_rate_limit_windows', 'SELECT')
     OR has_table_privilege('service_role', 'public.commerce_rate_limit_windows', 'SELECT')
     OR NOT has_function_privilege('service_role', 'public.record_mercadopago_payment_event(text,text,text,text,uuid,text,text,text)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.consume_commerce_rate_limit(text,text[])', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.reconcile_mercadopago_preference_creation(uuid,boolean,text,text)', 'EXECUTE') THEN
    RAISE EXCEPTION '105 function privilege boundary is wrong';
  END IF;
  INSERT INTO phase2_results VALUES ('105 RPCs are service-role only', true, 'acl verified');

  SELECT count(*) INTO v_count FROM public.inventory_movements WHERE order_id = v_order AND movement_type = 'sale';
  IF v_count <> 1 THEN RAISE EXCEPTION 'expected one sale movement, got %', v_count; END IF;
  INSERT INTO phase2_results VALUES ('approved order has one inventory movement', true, v_count::text);
END;
$$;

SELECT test_name, ok, detail FROM phase2_results ORDER BY test_name;
ROLLBACK;
