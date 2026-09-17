\set ON_ERROR_STOP on

BEGIN;

CREATE TEMP TABLE phase3m_results (
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
    v_id, p_name, 'Atomic fixture', 'test', 100, false, 0,
    true, 'AT-' || replace(v_id::text, '-', ''), lower(replace(p_name, ' ', '-')) || '-' || left(v_id::text, 8),
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
    gen_random_uuid(), 'atomic-' || p_label || '-' || gen_random_uuid()::text,
    NULL, p_label || '@example.test', p_label, NULL, 'pickup', '{}'::jsonb,
    v_items, 'atomic-token-' || p_label, 15
  );
  PERFORM public.attach_mercadopago_preference(
    v_order, 'pref-' || p_label, 'https://example.invalid/' || p_label
  );
  RETURN v_order;
END;
$$;

CREATE OR REPLACE FUNCTION pg_temp.fail_after_event()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF current_setting('rehabex.fail_after_event', true) = 'on' THEN
    RAISE EXCEPTION 'injected failure after event';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER phase3m_fail_after_event
BEFORE UPDATE ON public.orders
FOR EACH ROW EXECUTE FUNCTION pg_temp.fail_after_event();

DO $$
DECLARE
  v_product uuid;
  v_product_two uuid;
  v_order uuid;
  v_order_two uuid;
  v_event uuid;
  v_outcome text;
  v_duplicate boolean;
  v_stock integer;
  v_count integer;
  v_before timestamptz;
  v_a uuid := '00000000-0000-4000-8000-000000000101';
  v_b uuid := '00000000-0000-4000-8000-000000000102';
  v_c uuid := '00000000-0000-4000-8000-000000000103';
BEGIN
  -- A failure after INSERT payment_events must roll back the event and order.
  v_product := pg_temp.make_product('atomic rollback');
  v_order := pg_temp.make_order(ARRAY[v_product], 'rollback');
  SELECT updated_at INTO v_before FROM public.orders WHERE id = v_order;
  BEGIN
    PERFORM set_config('rehabex.fail_after_event', 'on', true);
    PERFORM public.process_mercadopago_payment_atomic(
      'request-rollback', 'payment-rollback', v_order::text, 'pref-rollback',
      'pending', 100, 'ARS', false, 'hash-rollback'
    );
    RAISE EXCEPTION 'injected failure did not abort';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    NULL;
  END;
  PERFORM set_config('rehabex.fail_after_event', 'off', true);
  IF EXISTS (SELECT 1 FROM public.payment_events WHERE provider_payment_id = 'payment-rollback')
     OR (SELECT updated_at FROM public.orders WHERE id = v_order) IS DISTINCT FROM v_before THEN
    RAISE EXCEPTION 'failure left an orphan event or changed the order';
  END IF;
  INSERT INTO phase3m_results VALUES ('failure after event rolls back everything', true, 'no event and unchanged order');

  -- Missing stock in the last locked line must not touch earlier products.
  INSERT INTO public.products (
    id, name, description, category, price, is_featured, display_order,
    is_active, sku, slug, currency, track_stock, allow_backorder,
    stock_on_hand, low_stock_threshold
  ) VALUES
    (v_a, 'atomic three a', 'fixture', 'test', 100, false, 0, true, 'AT-3-A', 'atomic-three-a', 'ARS', true, false, 1, 0),
    (v_b, 'atomic three b', 'fixture', 'test', 100, false, 0, true, 'AT-3-B', 'atomic-three-b', 'ARS', true, false, 1, 0),
    (v_c, 'atomic three c', 'fixture', 'test', 100, false, 0, true, 'AT-3-C', 'atomic-three-c', 'ARS', true, false, 1, 0);
  v_order := pg_temp.make_order(ARRAY[v_a, v_b, v_c], 'three-products');
  UPDATE public.stock_reservations
  SET status = 'expired', expires_at = now() - interval '1 minute', released_at = now()
  WHERE order_id = v_order;
  UPDATE public.products SET stock_on_hand = 0 WHERE id = v_c;

  SELECT event_id, outcome, is_duplicate INTO v_event, v_outcome, v_duplicate
  FROM public.process_mercadopago_payment_atomic(
    'request-three', 'payment-three', v_order::text, 'pref-three-products',
    'approved', 300, 'ARS', false, 'hash-three'
  );
  IF v_outcome <> 'review_refund_required'
     OR (SELECT stock_on_hand FROM public.products WHERE id = v_a) <> 1
     OR (SELECT stock_on_hand FROM public.products WHERE id = v_b) <> 1
     OR (SELECT stock_on_hand FROM public.products WHERE id = v_c) <> 0
     OR EXISTS (SELECT 1 FROM public.inventory_movements WHERE order_id = v_order)
     OR NOT (SELECT order_status = 'on_hold' AND refund_required FROM public.orders WHERE id = v_order) THEN
    RAISE EXCEPTION 'three-product preflight modified inventory or missed refund hold';
  END IF;
  INSERT INTO phase3m_results VALUES ('three-product preflight is all or nothing', true, 'last line unavailable; zero movements');

  -- Webhook and reconciliation have different request IDs but one logical event.
  v_product := pg_temp.make_product('atomic duplicate', 2);
  v_order := pg_temp.make_order(ARRAY[v_product], 'duplicate');
  SELECT event_id, outcome, is_duplicate INTO v_event, v_outcome, v_duplicate
  FROM public.process_mercadopago_payment_atomic(
    'webhook-request', 'payment-duplicate', v_order::text, 'pref-duplicate',
    'approved', 100, 'ARS', false, 'hash-duplicate-webhook'
  );
  IF v_outcome <> 'approved' OR v_duplicate THEN RAISE EXCEPTION 'first duplicate fixture call failed'; END IF;
  SELECT event_id, outcome, is_duplicate INTO v_event, v_outcome, v_duplicate
  FROM public.process_mercadopago_payment_atomic(
    NULL, 'payment-duplicate', v_order::text, 'pref-duplicate',
    'approved', 100, 'ARS', false, 'hash-duplicate-reconcile'
  );
  SELECT count(*) INTO v_count FROM public.payment_events
  WHERE provider = 'mercadopago' AND provider_payment_id = 'payment-duplicate' AND provider_status = 'approved';
  IF NOT v_duplicate OR v_outcome <> 'duplicate' OR v_count <> 1
     OR (SELECT stock_on_hand FROM public.products WHERE id = v_product) <> 1
     OR (SELECT count(*) FROM public.inventory_movements WHERE order_id = v_order) <> 1 THEN
    RAISE EXCEPTION 'cross-channel duplicate was not idempotent';
  END IF;
  INSERT INTO phase3m_results VALUES ('webhook and reconciliation deduplicate together', true, 'one event, transition and movement');

  -- Pending and in_process preserve reservations and map to pending.
  v_product := pg_temp.make_product('atomic pending');
  v_order := pg_temp.make_order(ARRAY[v_product], 'pending');
  SELECT outcome INTO v_outcome FROM public.process_mercadopago_payment_atomic(
    'request-pending', 'payment-pending', v_order::text, 'pref-pending',
    'pending', 100, 'ARS', false, 'hash-pending'
  );
  IF v_outcome <> 'pending' OR (SELECT payment_status FROM public.orders WHERE id = v_order) <> 'pending' THEN
    RAISE EXCEPTION 'pending transition failed';
  END IF;
  v_product_two := pg_temp.make_product('atomic in process');
  v_order_two := pg_temp.make_order(ARRAY[v_product_two], 'in-process');
  SELECT outcome INTO v_outcome FROM public.process_mercadopago_payment_atomic(
    'request-in-process', 'payment-in-process', v_order_two::text, 'pref-in-process',
    'in_process', 100, 'ARS', false, 'hash-in-process'
  );
  IF v_outcome <> 'in_process' OR (SELECT payment_status FROM public.orders WHERE id = v_order_two) <> 'pending' THEN
    RAISE EXCEPTION 'in_process transition failed';
  END IF;
  INSERT INTO phase3m_results VALUES ('pending states map without inventory changes', true, 'pending and in_process');

  -- Rejected and cancelled release their own reservations.
  v_product := pg_temp.make_product('atomic rejected');
  v_order := pg_temp.make_order(ARRAY[v_product], 'rejected');
  SELECT outcome INTO v_outcome FROM public.process_mercadopago_payment_atomic(
    'request-rejected', 'payment-rejected', v_order::text, 'pref-rejected',
    'rejected', 100, 'ARS', false, 'hash-rejected'
  );
  IF v_outcome <> 'rejected' OR (SELECT payment_status FROM public.orders WHERE id = v_order) <> 'rejected'
     OR (SELECT status FROM public.stock_reservations WHERE order_id = v_order) <> 'released' THEN
    RAISE EXCEPTION 'rejected transition failed';
  END IF;
  v_product_two := pg_temp.make_product('atomic cancelled');
  v_order_two := pg_temp.make_order(ARRAY[v_product_two], 'cancelled');
  SELECT outcome INTO v_outcome FROM public.process_mercadopago_payment_atomic(
    'request-cancelled', 'payment-cancelled', v_order_two::text, 'pref-cancelled',
    'cancelled', 100, 'ARS', false, 'hash-cancelled'
  );
  IF v_outcome <> 'cancelled' OR (SELECT payment_status FROM public.orders WHERE id = v_order_two) <> 'cancelled'
     OR (SELECT status FROM public.stock_reservations WHERE order_id = v_order_two) <> 'released' THEN
    RAISE EXCEPTION 'cancelled transition failed';
  END IF;
  INSERT INTO phase3m_results VALUES ('rejected and cancelled release reservations', true, 'both terminal states');

  -- Approved can be followed by refunded without automatic restock.
  v_product := pg_temp.make_product('atomic refunded', 2);
  v_order := pg_temp.make_order(ARRAY[v_product], 'refunded');
  SELECT outcome INTO v_outcome FROM public.process_mercadopago_payment_atomic(
    'request-approved-refund', 'payment-refunded', v_order::text, 'pref-refunded',
    'approved', 100, 'ARS', false, 'hash-approved-refund'
  );
  SELECT outcome INTO v_outcome FROM public.process_mercadopago_payment_atomic(
    'request-refunded', 'payment-refunded', v_order::text, 'pref-refunded',
    'refunded', 100, 'ARS', false, 'hash-refunded'
  );
  IF v_outcome <> 'refunded' OR (SELECT payment_status FROM public.orders WHERE id = v_order) <> 'refunded'
     OR (SELECT stock_on_hand FROM public.products WHERE id = v_product) <> 1 THEN
    RAISE EXCEPTION 'refunded transition failed or restocked automatically';
  END IF;
  INSERT INTO phase3m_results VALUES ('approved and refunded preserve sale stock', true, 'no automatic return');

  -- Approved can be followed by charged_back and requires review.
  v_product := pg_temp.make_product('atomic chargeback', 2);
  v_order := pg_temp.make_order(ARRAY[v_product], 'chargeback');
  PERFORM public.process_mercadopago_payment_atomic(
    'request-approved-chargeback', 'payment-chargeback', v_order::text, 'pref-chargeback',
    'approved', 100, 'ARS', false, 'hash-approved-chargeback'
  );
  SELECT outcome INTO v_outcome FROM public.process_mercadopago_payment_atomic(
    'request-chargeback', 'payment-chargeback', v_order::text, 'pref-chargeback',
    'charged_back', 100, 'ARS', false, 'hash-chargeback'
  );
  IF v_outcome <> 'charged_back'
     OR NOT (SELECT payment_status = 'charged_back' AND order_status = 'on_hold' AND review_required AND refund_required FROM public.orders WHERE id = v_order) THEN
    RAISE EXCEPTION 'charged_back transition failed';
  END IF;
  INSERT INTO phase3m_results VALUES ('charged_back requires review', true, 'approved to on_hold');

  -- TEST mode is enforced in the RPC itself and cannot mutate the order.
  v_product := pg_temp.make_product('atomic live rejected');
  v_order := pg_temp.make_order(ARRAY[v_product], 'live-rejected');
  SELECT outcome INTO v_outcome FROM public.process_mercadopago_payment_atomic(
    'request-live', 'payment-live', v_order::text, 'pref-live-rejected',
    'approved', 100, 'ARS', true, 'hash-live'
  );
  IF v_outcome <> 'rejected_test_mode'
     OR (SELECT payment_status FROM public.orders WHERE id = v_order) <> 'unpaid'
     OR (SELECT status FROM public.payment_events WHERE provider_payment_id = 'payment-live') <> 'failed' THEN
    RAISE EXCEPTION 'live payment was not rejected safely';
  END IF;
  INSERT INTO phase3m_results VALUES ('TEST mode is mandatory in the RPC', true, 'live_mode rejected');

  IF EXISTS (SELECT 1 FROM public.products WHERE stock_on_hand < 0) THEN
    RAISE EXCEPTION 'a product has negative stock';
  END IF;
  INSERT INTO phase3m_results VALUES ('stock never becomes negative', true, 'all fixtures nonnegative');

  IF has_function_privilege('anon', 'public.process_mercadopago_payment_atomic(text,text,text,text,text,numeric,text,boolean,text)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.process_mercadopago_payment_atomic(text,text,text,text,text,numeric,text,boolean,text)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.process_mercadopago_payment_atomic(text,text,text,text,text,numeric,text,boolean,text)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.record_mercadopago_payment_event(text,text,text,text,uuid,text,text,text)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.apply_mercadopago_payment_transition(uuid,uuid,text,text,numeric,text,text,text)', 'EXECUTE') THEN
    RAISE EXCEPTION '106 RPC privilege boundary is wrong';
  END IF;
  INSERT INTO phase3m_results VALUES ('atomic RPC ACL and legacy rollout grants are correct', true, 'atomic is service_role-only; legacy remains callable until 107');
END;
$$;

SELECT test_name, ok, detail FROM phase3m_results ORDER BY test_name;

ROLLBACK;
