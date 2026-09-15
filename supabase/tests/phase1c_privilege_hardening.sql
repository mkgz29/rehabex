\set ON_ERROR_STOP on

BEGIN;

CREATE TEMP TABLE phase1c_results (
  test_name text PRIMARY KEY,
  ok boolean NOT NULL,
  detail text
);

GRANT SELECT, INSERT, UPDATE, DELETE ON phase1c_results TO anon, authenticated, service_role;

DO $$
DECLARE
  v_customer_id uuid := gen_random_uuid();
  v_product_id uuid := gen_random_uuid();
  v_guest_order_id uuid;
  v_customer_order_id uuid;
  v_release_order_id uuid;
  v_count integer;
  v_stock integer;
  v_consumed boolean;
  v_table text;
  v_function regprocedure;
BEGIN
  -- All commerce tables must retain enabled and forced RLS.
  SELECT count(*)
  INTO v_count
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relname = ANY (ARRAY[
      'profiles', 'products', 'orders', 'settings', 'product_images',
      'order_items', 'stock_reservations', 'inventory_movements', 'payment_events'
    ])
    AND c.relrowsecurity
    AND c.relforcerowsecurity;

  IF v_count <> 9 THEN
    RAISE EXCEPTION 'expected enabled and forced RLS on 9 tables, got %', v_count;
  END IF;
  INSERT INTO phase1c_results VALUES ('RLS remains enabled and forced', true, v_count::text);

  -- No client or backend API role needs DDL-like table privileges.
  FOREACH v_table IN ARRAY ARRAY[
    'profiles', 'products', 'orders', 'settings', 'product_images',
    'order_items', 'stock_reservations', 'inventory_movements', 'payment_events'
  ]
  LOOP
    IF has_table_privilege('anon', format('public.%I', v_table), 'TRUNCATE')
       OR has_table_privilege('anon', format('public.%I', v_table), 'REFERENCES')
       OR has_table_privilege('anon', format('public.%I', v_table), 'TRIGGER')
       OR has_table_privilege('authenticated', format('public.%I', v_table), 'TRUNCATE')
       OR has_table_privilege('authenticated', format('public.%I', v_table), 'REFERENCES')
       OR has_table_privilege('authenticated', format('public.%I', v_table), 'TRIGGER')
       OR has_table_privilege('service_role', format('public.%I', v_table), 'TRUNCATE')
       OR has_table_privilege('service_role', format('public.%I', v_table), 'REFERENCES')
       OR has_table_privilege('service_role', format('public.%I', v_table), 'TRIGGER') THEN
      RAISE EXCEPTION 'unexpected DDL-like privilege on public.%', v_table;
    END IF;
  END LOOP;
  INSERT INTO phase1c_results VALUES ('API roles cannot truncate, reference or trigger', true, '9 tables');

  -- Anon can only read the three public catalog/CMS tables.
  IF NOT has_table_privilege('anon', 'public.products', 'SELECT')
     OR NOT has_table_privilege('anon', 'public.settings', 'SELECT')
     OR NOT has_table_privilege('anon', 'public.product_images', 'SELECT') THEN
    RAISE EXCEPTION 'anon lost an expected public read privilege';
  END IF;
  FOREACH v_table IN ARRAY ARRAY[
    'profiles', 'orders', 'order_items', 'stock_reservations',
    'inventory_movements', 'payment_events'
  ]
  LOOP
    IF has_table_privilege('anon', format('public.%I', v_table), 'SELECT') THEN
      RAISE EXCEPTION 'anon unexpectedly reads public.%', v_table;
    END IF;
  END LOOP;
  INSERT INTO phase1c_results VALUES ('anon table privileges are read-only and scoped', true, 'products, settings, product_images');

  -- Authenticated writes remain limited to objects with admin-only RLS policies.
  FOREACH v_table IN ARRAY ARRAY['profiles', 'orders', 'order_items', 'stock_reservations', 'inventory_movements', 'payment_events']
  LOOP
    IF has_table_privilege('authenticated', format('public.%I', v_table), 'INSERT')
       OR has_table_privilege('authenticated', format('public.%I', v_table), 'UPDATE')
       OR has_table_privilege('authenticated', format('public.%I', v_table), 'DELETE') THEN
      RAISE EXCEPTION 'authenticated unexpectedly writes public.%', v_table;
    END IF;
  END LOOP;
  INSERT INTO phase1c_results VALUES ('authenticated writes are limited to admin CMS tables', true, 'products, settings, product_images');

  -- Internal RPCs must be invisible to direct clients and executable by backend.
  FOREACH v_function IN ARRAY ARRAY[
    'public.next_order_number()'::regprocedure,
    'public.create_checkout_order(uuid,text,uuid,text,text,text,public.delivery_method,jsonb,jsonb,text,numeric,numeric,integer)'::regprocedure,
    'public.consume_order_reservation(uuid,text)'::regprocedure,
    'public.release_order_reservation(uuid,public.order_status)'::regprocedure
  ]
  LOOP
    IF has_function_privilege('anon', v_function, 'EXECUTE')
       OR has_function_privilege('authenticated', v_function, 'EXECUTE') THEN
      RAISE EXCEPTION 'client can execute internal function %', v_function;
    END IF;
    IF NOT has_function_privilege('service_role', v_function, 'EXECUTE') THEN
      RAISE EXCEPTION 'service_role cannot execute internal function %', v_function;
    END IF;
  END LOOP;
  INSERT INTO phase1c_results VALUES ('internal RPC execution is service-role only', true, '4 functions');

  IF has_sequence_privilege('anon', 'public.order_number_seq', 'USAGE')
     OR has_sequence_privilege('anon', 'public.order_number_seq', 'SELECT')
     OR has_sequence_privilege('anon', 'public.order_number_seq', 'UPDATE')
     OR has_sequence_privilege('authenticated', 'public.order_number_seq', 'USAGE')
     OR has_sequence_privilege('authenticated', 'public.order_number_seq', 'SELECT')
     OR has_sequence_privilege('authenticated', 'public.order_number_seq', 'UPDATE') THEN
    RAISE EXCEPTION 'client can access order_number_seq';
  END IF;
  IF NOT has_sequence_privilege('service_role', 'public.order_number_seq', 'USAGE')
     OR NOT has_sequence_privilege('service_role', 'public.order_number_seq', 'SELECT') THEN
    RAISE EXCEPTION 'service_role lost required sequence privileges';
  END IF;
  INSERT INTO phase1c_results VALUES ('order number sequence is backend-only', true, 'USAGE, SELECT');

  -- Confirm the captured default ACLs no longer leak privileges to new tables.
  CREATE TABLE public.phase1c_default_acl_probe (id integer);
  IF has_table_privilege('anon', 'public.phase1c_default_acl_probe', 'SELECT')
     OR has_table_privilege('authenticated', 'public.phase1c_default_acl_probe', 'SELECT')
     OR has_table_privilege('service_role', 'public.phase1c_default_acl_probe', 'SELECT') THEN
    RAISE EXCEPTION 'default table ACL still grants API role access';
  END IF;
  INSERT INTO phase1c_results VALUES ('future table ACLs require explicit grants', true, 'no API role grant');

  INSERT INTO auth.users (id, aud, role, email, created_at, updated_at)
  VALUES (v_customer_id, 'authenticated', 'authenticated', 'phase1c-customer@example.test', now(), now());

  INSERT INTO public.products (
    id, name, description, category, price, is_featured, display_order,
    is_active, sku, slug, currency, track_stock, allow_backorder,
    stock_on_hand, low_stock_threshold
  ) VALUES (
    v_product_id, 'Producto hardening', 'Fixture local', 'test', 100,
    false, 0, true, 'PHASE1C-SKU', 'phase1c-product', 'ARS', true, false, 10, 1
  );

  INSERT INTO public.settings (key, value)
  VALUES ('hero_content', '{"title":"Hardening"}'::jsonb);

  -- A guest checkout is created by the backend role, not by anon directly.
  EXECUTE 'SET LOCAL ROLE service_role';
  SELECT c.order_id
  INTO v_guest_order_id
  FROM public.create_checkout_order(
    gen_random_uuid(), 'phase1c-guest', NULL,
    'guest@example.test', 'Guest Test', NULL, 'pickup',
    '{"pickupLocationLabel":"Rehabex"}'::jsonb,
    jsonb_build_array(jsonb_build_object('productId', v_product_id, 'quantity', 1)),
    'phase1c-guest-status-hash', 0, 0, 15
  ) AS c;

  SELECT public.consume_order_reservation(v_guest_order_id, 'phase1c-payment') INTO v_consumed;
  EXECUTE 'RESET ROLE';

  IF v_guest_order_id IS NULL OR v_consumed IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'service-role guest checkout/consume failed';
  END IF;
  SELECT stock_on_hand INTO v_stock FROM public.products WHERE id = v_product_id;
  IF v_stock <> 9 THEN
    RAISE EXCEPTION 'expected stock 9 after guest checkout consume, got %', v_stock;
  END IF;
  INSERT INTO phase1c_results VALUES ('guest checkout works through service backend', true, v_guest_order_id::text);

  -- Create an owned order to confirm the existing authenticated RLS contract.
  EXECUTE 'SET LOCAL ROLE service_role';
  SELECT c.order_id
  INTO v_customer_order_id
  FROM public.create_checkout_order(
    gen_random_uuid(), 'phase1c-customer', v_customer_id,
    'phase1c-customer@example.test', 'Customer Test', NULL, 'pickup',
    '{"pickupLocationLabel":"Rehabex"}'::jsonb,
    jsonb_build_array(jsonb_build_object('productId', v_product_id, 'quantity', 1)),
    'phase1c-customer-status-hash', 0, 0, 15
  ) AS c;

  SELECT c.order_id
  INTO v_release_order_id
  FROM public.create_checkout_order(
    gen_random_uuid(), 'phase1c-release', NULL,
    'release@example.test', 'Release Test', NULL, 'pickup',
    '{"pickupLocationLabel":"Rehabex"}'::jsonb,
    jsonb_build_array(jsonb_build_object('productId', v_product_id, 'quantity', 1)),
    'phase1c-release-status-hash', 0, 0, 15
  ) AS c;
  PERFORM public.release_order_reservation(v_release_order_id, 'expired');
  EXECUTE 'RESET ROLE';

  PERFORM set_config('request.jwt.claim.sub', v_customer_id::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  EXECUTE format('SELECT count(*) FROM public.orders WHERE id = %L::uuid', v_customer_order_id) INTO v_count;
  EXECUTE 'RESET ROLE';
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'authenticated customer lost own-order read access';
  END IF;
  INSERT INTO phase1c_results VALUES ('authenticated authorized read still works', true, 'own order only');

  -- An actual client invocation must fail at the ACL boundary.
  EXECUTE 'SET LOCAL ROLE anon';
  BEGIN
    EXECUTE 'SELECT public.next_order_number()';
    RAISE EXCEPTION 'anon unexpectedly executed next_order_number';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
  EXECUTE 'RESET ROLE';
  INSERT INTO phase1c_results VALUES ('anon invocation is rejected by function ACL', true, '42501');
END
$$;

SELECT test_name, ok, detail
FROM phase1c_results
ORDER BY test_name;

ROLLBACK;
