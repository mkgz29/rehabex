\set ON_ERROR_STOP on

BEGIN;

CREATE TEMP TABLE phase1b_results (
  test_name text PRIMARY KEY,
  ok boolean NOT NULL,
  detail text
);

GRANT SELECT, INSERT, UPDATE, DELETE ON phase1b_results TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON phase1b_results TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON phase1b_results TO service_role;

DO $$
DECLARE
  v_admin_id uuid := gen_random_uuid();
  v_customer_id uuid := gen_random_uuid();
  v_other_id uuid := gen_random_uuid();
  v_product_id uuid := gen_random_uuid();
  v_order_id uuid;
  v_second_order_id uuid;
  v_other_order_id uuid;
  v_order_number text;
  v_count integer;
  v_stock integer;
  v_consumed boolean;
BEGIN
  INSERT INTO auth.users (id, aud, role, email, created_at, updated_at)
  VALUES
    (v_admin_id, 'authenticated', 'authenticated', 'admin@example.test', now(), now()),
    (v_customer_id, 'authenticated', 'authenticated', 'customer@example.test', now(), now()),
    (v_other_id, 'authenticated', 'authenticated', 'other@example.test', now(), now());

  UPDATE public.profiles SET role = 'admin' WHERE id = v_admin_id;

  INSERT INTO public.products (
    id,
    name,
    description,
    category,
    price,
    image_url,
    is_featured,
    display_order,
    is_active,
    sku,
    slug,
    currency,
    primary_image_url,
    track_stock,
    allow_backorder,
    stock_on_hand,
    low_stock_threshold
  )
  VALUES (
    v_product_id,
    'Producto test',
    'Producto local para pruebas',
    'test',
    100,
    'https://example.test/product.png',
    false,
    0,
    true,
    'TEST-SKU-1',
    'producto-test',
    'ARS',
    'https://example.test/product.png',
    true,
    false,
    5,
    1
  );

  INSERT INTO public.settings (key, value)
  VALUES
    ('hero_content', '{"title":"Hero"}'::jsonb),
    ('about_content', '{"title":"About"}'::jsonb),
    ('private_setting', '{"secret":true}'::jsonb);

  INSERT INTO public.orders (
    user_id,
    status,
    amount,
    items,
    customer_email,
    customer_name,
    subtotal_amount,
    shipping_amount,
    discount_amount,
    total_amount,
    payment_status,
    fulfillment_status,
    order_status
  )
  VALUES (
    v_other_id,
    'pending',
    10,
    '[]'::jsonb,
    'other@example.test',
    'Other',
    10,
    0,
    0,
    10,
    'pending',
    'not_started',
    'pending_payment'
  )
  RETURNING id INTO v_other_order_id;

  PERFORM set_config('request.jwt.claim.sub', '', true);
  EXECUTE 'SET LOCAL ROLE anon';
  EXECUTE 'SELECT count(*) FROM public.products' INTO v_count;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'anon expected 1 active product, got %', v_count;
  END IF;
  INSERT INTO phase1b_results VALUES ('anon reads active products', true, v_count::text);

  EXECUTE 'SELECT count(*) FROM public.settings' INTO v_count;
  IF v_count <> 2 THEN
    RAISE EXCEPTION 'anon expected 2 public settings, got %', v_count;
  END IF;
  INSERT INTO phase1b_results VALUES ('anon reads only public settings', true, v_count::text);

  BEGIN
    EXECUTE 'INSERT INTO public.products (name, price, description) VALUES (''bad'', 1, ''bad'')';
    RAISE EXCEPTION 'anon unexpectedly inserted product';
  EXCEPTION WHEN insufficient_privilege OR check_violation THEN
    INSERT INTO phase1b_results VALUES ('anon cannot insert products', true, SQLSTATE);
  END;

  BEGIN
    EXECUTE 'SELECT count(*) FROM public.orders' INTO v_count;
    RAISE EXCEPTION 'anon unexpectedly read orders';
  EXCEPTION WHEN insufficient_privilege THEN
    INSERT INTO phase1b_results VALUES ('anon cannot read orders', true, SQLSTATE);
  END;
  EXECUTE 'RESET ROLE';

  SELECT c.order_id, c.order_number
  INTO v_order_id, v_order_number
  FROM public.create_checkout_order(
    gen_random_uuid(),
    'hash-1',
    v_customer_id,
    'customer@example.test',
    'Customer Test',
    '+549111111111',
    'delivery',
    '{"addressLine1":"Calle 123","city":"CABA","province":"Buenos Aires","postalCode":"1000"}'::jsonb,
    jsonb_build_array(jsonb_build_object('productId', v_product_id, 'quantity', 2)),
    'status-token-hash',
    50,
    0,
    15
  ) AS c;

  IF v_order_id IS NULL OR v_order_number IS NULL THEN
    RAISE EXCEPTION 'create_checkout_order did not return order';
  END IF;
  INSERT INTO phase1b_results VALUES ('create_checkout_order returns order', true, v_order_number);

  SELECT count(*) INTO v_count FROM public.order_items WHERE order_id = v_order_id;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'expected 1 order item, got %', v_count;
  END IF;
  INSERT INTO phase1b_results VALUES ('checkout creates order item', true, v_count::text);

  SELECT count(*) INTO v_count FROM public.stock_reservations WHERE order_id = v_order_id AND status = 'active';
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'expected 1 active reservation, got %', v_count;
  END IF;
  INSERT INTO phase1b_results VALUES ('checkout creates stock reservation', true, v_count::text);

  SELECT public.consume_order_reservation(v_order_id, 'mp-test-1') INTO v_consumed;
  IF v_consumed IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'consume_order_reservation returned false';
  END IF;

  SELECT stock_on_hand INTO v_stock FROM public.products WHERE id = v_product_id;
  IF v_stock <> 3 THEN
    RAISE EXCEPTION 'expected stock 3 after consume, got %', v_stock;
  END IF;
  INSERT INTO phase1b_results VALUES ('consume reservation decrements stock once', true, v_stock::text);

  SELECT public.consume_order_reservation(v_order_id, 'mp-test-1') INTO v_consumed;
  SELECT stock_on_hand INTO v_stock FROM public.products WHERE id = v_product_id;
  IF v_stock <> 3 THEN
    RAISE EXCEPTION 'expected idempotent stock 3 after second consume, got %', v_stock;
  END IF;
  INSERT INTO phase1b_results VALUES ('consume reservation is idempotent', true, v_stock::text);

  SELECT c.order_id
  INTO v_second_order_id
  FROM public.create_checkout_order(
    gen_random_uuid(),
    'hash-2',
    v_customer_id,
    'customer@example.test',
    'Customer Test',
    null,
    'pickup',
    '{"pickupLocationLabel":"Local Rehabex","pickupWindow":"A coordinar"}'::jsonb,
    jsonb_build_array(jsonb_build_object('productId', v_product_id, 'quantity', 1)),
    'status-token-hash-2',
    0,
    0,
    15
  ) AS c;

  PERFORM public.release_order_reservation(v_second_order_id, 'expired');
  SELECT count(*) INTO v_count FROM public.stock_reservations WHERE order_id = v_second_order_id AND status = 'expired';
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'expected expired reservation, got %', v_count;
  END IF;
  INSERT INTO phase1b_results VALUES ('release_order_reservation expires reservation', true, v_count::text);

  BEGIN
    PERFORM public.create_checkout_order(
      gen_random_uuid(),
      'hash-stock-fail',
      v_customer_id,
      'customer@example.test',
      'Customer Test',
      null,
      'pickup',
      '{}'::jsonb,
      jsonb_build_array(jsonb_build_object('productId', v_product_id, 'quantity', 999)),
      'status-token-hash-3',
      0,
      0,
      15
    );
    RAISE EXCEPTION 'stock failure checkout unexpectedly succeeded';
  EXCEPTION WHEN raise_exception THEN
    INSERT INTO phase1b_results VALUES ('checkout rejects insufficient stock', true, SQLERRM);
  END;

  PERFORM set_config('request.jwt.claim.sub', v_customer_id::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  EXECUTE format('SELECT count(*) FROM public.orders WHERE id = %L::uuid', v_order_id) INTO v_count;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'customer expected own order only';
  END IF;
  INSERT INTO phase1b_results VALUES ('customer reads own order', true, v_count::text);

  EXECUTE format('SELECT count(*) FROM public.orders WHERE id = %L::uuid', v_other_order_id) INTO v_count;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'customer unexpectedly saw another user order';
  END IF;
  INSERT INTO phase1b_results VALUES ('customer cannot read other orders', true, v_count::text);

  BEGIN
    EXECUTE format('UPDATE public.profiles SET role = ''admin'' WHERE id = %L::uuid', v_customer_id);
    RAISE EXCEPTION 'customer unexpectedly updated profile role';
  EXCEPTION WHEN insufficient_privilege THEN
    INSERT INTO phase1b_results VALUES ('customer cannot update profile role', true, SQLSTATE);
  END;
  EXECUTE 'RESET ROLE';

  PERFORM set_config('request.jwt.claim.sub', v_admin_id::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  EXECUTE format('UPDATE public.products SET display_order = display_order + 1 WHERE id = %L::uuid', v_product_id);
  GET DIAGNOSTICS v_count = ROW_COUNT;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'admin expected to update one product, got %', v_count;
  END IF;
  INSERT INTO phase1b_results VALUES ('admin updates products', true, v_count::text);

  EXECUTE 'UPDATE public.settings SET value = ''{"title":"Hero 2"}''::jsonb WHERE key = ''hero_content''';
  GET DIAGNOSTICS v_count = ROW_COUNT;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'admin expected to update one setting, got %', v_count;
  END IF;
  INSERT INTO phase1b_results VALUES ('admin updates settings', true, v_count::text);
  EXECUTE 'RESET ROLE';
END
$$;

SELECT test_name, ok, detail
FROM phase1b_results
ORDER BY test_name;

ROLLBACK;
