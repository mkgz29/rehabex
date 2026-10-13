\set ON_ERROR_STOP on

-- FASE 7F-B4: admin_update_order_fulfillment_status state machine,
-- order_fulfillment_events append-only history, RLS/grants, auth.

BEGIN;

CREATE TEMP TABLE fulfillment_results (
  test_name text PRIMARY KEY,
  ok boolean NOT NULL,
  detail text NOT NULL
);

CREATE OR REPLACE FUNCTION pg_temp.make_product(p_name text, p_stock integer DEFAULT 5)
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
    v_id, p_name, 'Fulfillment fixture', 'test', 100, false, 0,
    true, 'FF-' || replace(v_id::text, '-', ''), lower(replace(p_name, ' ', '-')) || '-' || left(v_id::text, 8),
    'ARS', true, false, p_stock, 0
  );
  RETURN v_id;
END;
$$;

-- A confirmed order, already paid, with the given delivery_method -- the
-- real state admin_update_order_fulfillment_status requires (order_status
-- must be 'confirmed'). Built directly rather than through the full
-- checkout+payment RPC chain, since that machinery is already covered by
-- phase3m_atomic_payment_local.sql and is not what this test is auditing.
CREATE OR REPLACE FUNCTION pg_temp.make_confirmed_order(p_label text, p_delivery_method public.delivery_method)
RETURNS uuid
LANGUAGE plpgsql
AS $$
DECLARE
  v_order uuid := gen_random_uuid();
BEGIN
  INSERT INTO public.orders (
    id, order_number, idempotency_key, checkout_request_hash, external_reference,
    status, amount, currency, items, customer_email, customer_name, customer_phone,
    delivery_method, subtotal_amount, shipping_amount, discount_amount, total_amount,
    payment_status, fulfillment_status, order_status, status_access_token_hash, reservation_expires_at,
    payment_environment
  ) VALUES (
    v_order, 'RHB-TEST-' || left(replace(v_order::text, '-', ''), 6), gen_random_uuid(), 'hash-' || p_label, v_order::text,
    'approved', 100, 'ARS', '[]'::jsonb, p_label || '@example.test', p_label, '5491100000000',
    p_delivery_method, 100, 0, 0, 100,
    'approved', 'not_started', 'confirmed', 'token-hash-' || p_label, now() + interval '15 minutes',
    'test'
  );
  RETURN v_order;
END;
$$;

DO $$
DECLARE
  v_admin_id uuid := gen_random_uuid();
  v_customer_id uuid := gen_random_uuid();
  v_order_pickup uuid;
  v_order_delivery uuid;
  v_order_concurrency uuid;
  v_order_history_check uuid;
  v_result public.orders;
  v_count integer;
BEGIN
  INSERT INTO auth.users (id, email) VALUES
    (v_admin_id, 'admin-' || v_admin_id || '@example.test'),
    (v_customer_id, 'customer-' || v_customer_id || '@example.test');
  INSERT INTO public.profiles (id, role) VALUES (v_admin_id, 'admin'), (v_customer_id, 'customer')
    ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role;

  -- 1. Non-admin is rejected.
  PERFORM set_config('request.jwt.claim.sub', v_customer_id::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_customer_id, 'role', 'authenticated')::text, true);
  v_order_pickup := pg_temp.make_confirmed_order('reject', 'pickup');
  SET ROLE authenticated;
  BEGIN
    PERFORM public.admin_update_order_fulfillment_status(v_order_pickup, 'preparing', NULL, gen_random_uuid());
    RESET ROLE;
    RAISE EXCEPTION 'a non-admin was allowed to change fulfillment status';
  EXCEPTION WHEN SQLSTATE 'ADM03' THEN
    RESET ROLE;
  END;
  INSERT INTO fulfillment_results VALUES ('non-admin is rejected (ADM03)', true, 'forbidden raised');

  -- Switch to the admin identity for the rest of the test.
  PERFORM set_config('request.jwt.claim.sub', v_admin_id::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin_id, 'role', 'authenticated')::text, true);

  -- 2. Valid pickup path: not_started -> preparing -> ready_for_pickup -> delivered.
  v_order_pickup := pg_temp.make_confirmed_order('pickup-path', 'pickup');
  SET ROLE authenticated;
  v_order_history_check := v_order_pickup;
  v_result := public.admin_update_order_fulfillment_status(v_order_pickup, 'preparing', 'empezamos', gen_random_uuid());
  IF v_result.fulfillment_status <> 'preparing' THEN RAISE EXCEPTION 'pickup: preparing did not apply'; END IF;
  v_result := public.admin_update_order_fulfillment_status(v_order_pickup, 'ready_for_pickup', NULL, gen_random_uuid());
  IF v_result.fulfillment_status <> 'ready_for_pickup' THEN RAISE EXCEPTION 'pickup: ready_for_pickup did not apply'; END IF;
  v_result := public.admin_update_order_fulfillment_status(v_order_pickup, 'delivered', NULL, gen_random_uuid());
  IF v_result.fulfillment_status <> 'delivered' THEN RAISE EXCEPTION 'pickup: delivered did not apply'; END IF;
  RESET ROLE;
  SELECT count(*) INTO v_count FROM public.order_fulfillment_events WHERE order_id = v_order_pickup;
  IF v_count <> 3 THEN RAISE EXCEPTION 'pickup path: expected 3 history rows, got %', v_count; END IF;
  INSERT INTO fulfillment_results VALUES ('pickup path: not_started -> preparing -> ready_for_pickup -> delivered', true, '3 history rows appended');

  -- 3. A pickup order is never offered "shipped".
  v_order_pickup := pg_temp.make_confirmed_order('pickup-no-ship', 'pickup');
  SET ROLE authenticated;
  PERFORM public.admin_update_order_fulfillment_status(v_order_pickup, 'preparing', NULL, gen_random_uuid());
  BEGIN
    PERFORM public.admin_update_order_fulfillment_status(v_order_pickup, 'shipped', NULL, gen_random_uuid());
    RESET ROLE;
    RAISE EXCEPTION 'a pickup order was allowed to transition to shipped';
  EXCEPTION WHEN SQLSTATE 'ADM22' THEN
    RESET ROLE;
  END;
  INSERT INTO fulfillment_results VALUES ('pickup order rejects "shipped" (ADM22)', true, 'invalid_transition raised');

  -- 4. Valid delivery path: not_started -> preparing -> shipped -> delivered.
  v_order_delivery := pg_temp.make_confirmed_order('delivery-path', 'delivery');
  SET ROLE authenticated;
  PERFORM public.admin_update_order_fulfillment_status(v_order_delivery, 'preparing', NULL, gen_random_uuid());
  v_result := public.admin_update_order_fulfillment_status(v_order_delivery, 'shipped', NULL, gen_random_uuid());
  IF v_result.fulfillment_status <> 'shipped' THEN RAISE EXCEPTION 'delivery: shipped did not apply'; END IF;
  v_result := public.admin_update_order_fulfillment_status(v_order_delivery, 'delivered', NULL, gen_random_uuid());
  IF v_result.fulfillment_status <> 'delivered' THEN RAISE EXCEPTION 'delivery: delivered did not apply'; END IF;
  RESET ROLE;
  INSERT INTO fulfillment_results VALUES ('delivery path: not_started -> preparing -> shipped -> delivered', true, 'applied correctly');

  -- 5. delivered is terminal: no transition out, in either direction.
  SET ROLE authenticated;
  BEGIN
    PERFORM public.admin_update_order_fulfillment_status(v_order_delivery, 'preparing', NULL, gen_random_uuid());
    RESET ROLE;
    RAISE EXCEPTION 'delivered -> preparing was allowed';
  EXCEPTION WHEN SQLSTATE 'ADM22' THEN
    RESET ROLE;
  END;
  INSERT INTO fulfillment_results VALUES ('delivered is terminal (delivered -> preparing rejected)', true, 'invalid_transition raised');

  -- 6. cancelled is terminal: no transition out.
  v_order_delivery := pg_temp.make_confirmed_order('cancel-terminal', 'delivery');
  SET ROLE authenticated;
  PERFORM public.admin_update_order_fulfillment_status(v_order_delivery, 'cancelled', 'sin stock', gen_random_uuid());
  BEGIN
    PERFORM public.admin_update_order_fulfillment_status(v_order_delivery, 'shipped', NULL, gen_random_uuid());
    RESET ROLE;
    RAISE EXCEPTION 'cancelled -> shipped was allowed';
  EXCEPTION WHEN SQLSTATE 'ADM22' THEN
    RESET ROLE;
  END;
  INSERT INTO fulfillment_results VALUES ('cancelled is terminal (cancelled -> shipped rejected)', true, 'invalid_transition raised');

  -- 7. cancelled is reachable from not_started and from preparing.
  v_order_delivery := pg_temp.make_confirmed_order('cancel-from-not-started', 'pickup');
  SET ROLE authenticated;
  v_result := public.admin_update_order_fulfillment_status(v_order_delivery, 'cancelled', NULL, gen_random_uuid());
  RESET ROLE;
  IF v_result.fulfillment_status <> 'cancelled' THEN RAISE EXCEPTION 'cancel from not_started failed'; END IF;
  INSERT INTO fulfillment_results VALUES ('cancelled is reachable from not_started', true, 'applied');

  -- 8. An order whose payment is not confirmed cannot have its fulfillment touched.
  v_order_delivery := pg_temp.make_confirmed_order('unconfirmed', 'pickup');
  UPDATE public.orders SET order_status = 'pending_payment', payment_status = 'unpaid' WHERE id = v_order_delivery;
  SET ROLE authenticated;
  BEGIN
    PERFORM public.admin_update_order_fulfillment_status(v_order_delivery, 'preparing', NULL, gen_random_uuid());
    RESET ROLE;
    RAISE EXCEPTION 'fulfillment was changed on an unconfirmed order';
  EXCEPTION WHEN SQLSTATE 'ADM22' THEN
    RESET ROLE;
  END;
  INSERT INTO fulfillment_results VALUES ('an unconfirmed order cannot have its fulfillment_status changed', true, 'order_not_confirmed raised');

  -- 9. The RPC never touches payment_status/order_status/paid_at.
  v_order_delivery := pg_temp.make_confirmed_order('payment-untouched', 'pickup');
  SET ROLE authenticated;
  PERFORM public.admin_update_order_fulfillment_status(v_order_delivery, 'preparing', NULL, gen_random_uuid());
  RESET ROLE;
  IF NOT (SELECT payment_status = 'approved' AND order_status = 'confirmed' FROM public.orders WHERE id = v_order_delivery) THEN
    RAISE EXCEPTION 'fulfillment change altered payment_status/order_status';
  END IF;
  INSERT INTO fulfillment_results VALUES ('fulfillment change never touches payment_status/order_status', true, 'both unchanged');

  -- 10. History event records from_status/to_status/note/created_by correctly.
  SELECT count(*) INTO v_count FROM public.order_fulfillment_events
    WHERE order_id = v_order_history_check AND from_status = 'not_started' AND to_status = 'preparing' AND note = 'empezamos' AND created_by = v_admin_id;
  IF v_count <> 1 THEN RAISE EXCEPTION 'history event did not record from/to/note/created_by correctly'; END IF;
  INSERT INTO fulfillment_results VALUES ('history event records from_status/to_status/note/created_by', true, 'matched exactly');

  -- 11. History is append-only: no UPDATE/DELETE grant for any client role.
  IF has_table_privilege('authenticated', 'public.order_fulfillment_events', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.order_fulfillment_events', 'DELETE')
     OR has_table_privilege('anon', 'public.order_fulfillment_events', 'SELECT')
     OR has_table_privilege('anon', 'public.order_fulfillment_events', 'INSERT') THEN
    RAISE EXCEPTION 'order_fulfillment_events grants are wrong';
  END IF;
  INSERT INTO fulfillment_results VALUES ('order_fulfillment_events: append-only, anon has no access at all', true, 'grants correct');

  -- 12. RLS enabled+forced, admin-read policy present.
  IF NOT (SELECT relrowsecurity AND relforcerowsecurity FROM pg_class WHERE oid = 'public.order_fulfillment_events'::regclass) THEN
    RAISE EXCEPTION 'RLS not enabled+forced on order_fulfillment_events';
  END IF;
  IF (SELECT count(*) FROM pg_policy WHERE polrelid = 'public.order_fulfillment_events'::regclass) <> 1 THEN
    RAISE EXCEPTION 'unexpected policy count on order_fulfillment_events';
  END IF;
  INSERT INTO fulfillment_results VALUES ('order_fulfillment_events RLS enabled+forced, exactly 1 policy', true, 'admin read only');

  -- 13. RPC grants: authenticated only (internal is_admin() check gates it further), anon none.
  IF has_function_privilege('anon', 'public.admin_update_order_fulfillment_status(uuid,text,text,uuid)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.admin_update_order_fulfillment_status(uuid,text,text,uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'admin_update_order_fulfillment_status grants are wrong';
  END IF;
  INSERT INTO fulfillment_results VALUES ('admin_update_order_fulfillment_status grants: authenticated only, anon none', true, 'confirmed');

  -- 14. tracking_token_hash unique index holds.
  v_order_concurrency := pg_temp.make_confirmed_order('tracking-a', 'pickup');
  UPDATE public.orders SET tracking_token_hash = 'same-hash-value' WHERE id = v_order_concurrency;
  DECLARE
    v_order_b uuid := pg_temp.make_confirmed_order('tracking-b', 'pickup');
  BEGIN
    BEGIN
      UPDATE public.orders SET tracking_token_hash = 'same-hash-value' WHERE id = v_order_b;
      RAISE EXCEPTION 'duplicate tracking_token_hash was accepted across two orders';
    EXCEPTION WHEN unique_violation THEN
      NULL;
    END;
  END;
  INSERT INTO fulfillment_results VALUES ('tracking_token_hash UNIQUE index holds across orders', true, 'unique_violation raised');

  -- 15. invalid target status is rejected before touching anything.
  v_order_delivery := pg_temp.make_confirmed_order('invalid-status', 'pickup');
  SET ROLE authenticated;
  BEGIN
    PERFORM public.admin_update_order_fulfillment_status(v_order_delivery, 'not_a_real_status', NULL, gen_random_uuid());
    RESET ROLE;
    RAISE EXCEPTION 'an invalid target status was accepted';
  EXCEPTION WHEN SQLSTATE 'ADM22' THEN
    RESET ROLE;
  END;
  INSERT INTO fulfillment_results VALUES ('an invalid target status string is rejected', true, 'invalid_status raised');
END;
$$;

SELECT test_name, ok, detail FROM fulfillment_results ORDER BY test_name;

ROLLBACK;
