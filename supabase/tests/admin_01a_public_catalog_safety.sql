\set ON_ERROR_STOP on

BEGIN;

CREATE TEMP TABLE admin_01a_results (
  test_name text PRIMARY KEY,
  ok boolean NOT NULL,
  detail text
);

DO $$
DECLARE
  v_customer_id uuid := gen_random_uuid();
  v_admin_id uuid := gen_random_uuid();
  v_public_id uuid := gen_random_uuid();
  v_partial_id uuid := gen_random_uuid();
  v_test_id uuid := gen_random_uuid();
  v_prueba_id uuid := gen_random_uuid();
  v_inactive_id uuid := gen_random_uuid();
  v_admin_product_id uuid := gen_random_uuid();
  v_private_key text := 'admin_01a_private_' || replace(gen_random_uuid()::text, '-', '');
  v_count integer;
  v_denied boolean;
  v_is_admin boolean;
BEGIN
  INSERT INTO auth.users (id, aud, role, email, created_at, updated_at)
  VALUES
    (v_customer_id, 'authenticated', 'authenticated', 'admin-01a-customer@example.test', now(), now()),
    (v_admin_id, 'authenticated', 'authenticated', 'admin-01a-admin@example.test', now(), now());

  UPDATE public.profiles SET role = 'admin' WHERE id = v_admin_id;

  INSERT INTO public.products (
    id, name, description, category, price, is_featured, display_order,
    is_active, currency, track_stock, allow_backorder, stock_on_hand,
    low_stock_threshold
  ) VALUES
    (v_public_id, 'ADMIN-01A visible', 'Fixture sintetico local', 'Ortopedia', 100, false, 0, true, 'ARS', true, false, 1, 0),
    (v_partial_id, 'ADMIN-01A partial', 'Fixture sintetico local', 'Contest', 100, false, 1, true, 'ARS', true, false, 1, 0),
    (v_test_id, 'ADMIN-01A test', 'Fixture sintetico local', ' TEST ', 100, false, 2, true, 'ARS', true, false, 1, 0),
    (v_prueba_id, 'ADMIN-01A prueba', 'Fixture sintetico local', 'PrUeBa', 100, false, 3, true, 'ARS', true, false, 1, 0),
    (v_inactive_id, 'ADMIN-01A inactive', 'Fixture sintetico local', 'Ortopedia', 100, false, 4, false, 'ARS', true, false, 1, 0);

  INSERT INTO public.settings (key, value)
  VALUES (v_private_key, '{"scope":"synthetic-local"}'::jsonb);

  EXECUTE 'SET LOCAL ROLE anon';
  SELECT count(*) INTO v_count FROM public.products WHERE id = v_public_id;
  EXECUTE 'RESET ROLE';
  IF v_count <> 1 THEN RAISE EXCEPTION 'anon cannot read the valid public fixture'; END IF;
  INSERT INTO admin_01a_results VALUES ('anon reads a valid public product', true, '1 row');

  EXECUTE 'SET LOCAL ROLE anon';
  SELECT count(*) INTO v_count FROM public.products WHERE id = v_partial_id;
  EXECUTE 'RESET ROLE';
  IF v_count <> 1 THEN RAISE EXCEPTION 'anon incorrectly hid a partial category match'; END IF;
  INSERT INTO admin_01a_results VALUES ('anon keeps partial category words visible', true, '1 row');

  EXECUTE 'SET LOCAL ROLE anon';
  SELECT count(*) INTO v_count FROM public.products WHERE id = v_inactive_id;
  EXECUTE 'RESET ROLE';
  IF v_count <> 0 THEN RAISE EXCEPTION 'anon read an inactive product'; END IF;
  INSERT INTO admin_01a_results VALUES ('anon hides inactive products', true, '0 rows');

  EXECUTE 'SET LOCAL ROLE anon';
  SELECT count(*) INTO v_count FROM public.products WHERE id = v_test_id;
  EXECUTE 'RESET ROLE';
  IF v_count <> 0 THEN RAISE EXCEPTION 'anon read a TEST product'; END IF;
  INSERT INTO admin_01a_results VALUES ('anon hides trimmed uppercase TEST', true, '0 rows');

  EXECUTE 'SET LOCAL ROLE anon';
  SELECT count(*) INTO v_count FROM public.products WHERE id = v_prueba_id;
  EXECUTE 'RESET ROLE';
  IF v_count <> 0 THEN RAISE EXCEPTION 'anon read a mixed-case PRUEBA product'; END IF;
  INSERT INTO admin_01a_results VALUES ('anon hides mixed-case PRUEBA', true, '0 rows');

  v_denied := false;
  EXECUTE 'SET LOCAL ROLE anon';
  BEGIN
    INSERT INTO public.products (id, name, description, category, price, is_featured, display_order, is_active)
    VALUES (gen_random_uuid(), 'Forbidden anon insert', '', 'Ortopedia', 100, false, 0, true);
  EXCEPTION WHEN insufficient_privilege THEN
    v_denied := true;
  END;
  EXECUTE 'RESET ROLE';
  IF NOT v_denied THEN RAISE EXCEPTION 'anon inserted a product'; END IF;
  INSERT INTO admin_01a_results VALUES ('anon cannot insert products', true, 'denied');

  v_denied := false;
  EXECUTE 'SET LOCAL ROLE anon';
  BEGIN
    UPDATE public.products SET name = 'Forbidden anon update' WHERE id = v_public_id;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    v_denied := v_count = 0;
  EXCEPTION WHEN insufficient_privilege THEN
    v_denied := true;
  END;
  EXECUTE 'RESET ROLE';
  IF NOT v_denied THEN RAISE EXCEPTION 'anon updated a product'; END IF;
  INSERT INTO admin_01a_results VALUES ('anon cannot update products', true, 'denied');

  v_denied := false;
  EXECUTE 'SET LOCAL ROLE anon';
  BEGIN
    DELETE FROM public.products WHERE id = v_public_id;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    v_denied := v_count = 0;
  EXCEPTION WHEN insufficient_privilege THEN
    v_denied := true;
  END;
  EXECUTE 'RESET ROLE';
  IF NOT v_denied THEN RAISE EXCEPTION 'anon deleted a product'; END IF;
  INSERT INTO admin_01a_results VALUES ('anon cannot delete products', true, 'denied');

  EXECUTE 'SET LOCAL ROLE anon';
  SELECT count(*) INTO v_count FROM public.settings WHERE key = v_private_key;
  EXECUTE 'RESET ROLE';
  IF v_count <> 0 THEN RAISE EXCEPTION 'anon read a private setting'; END IF;
  INSERT INTO admin_01a_results VALUES ('anon cannot read private settings', true, '0 rows');

  IF has_function_privilege('anon', 'public.is_admin()', 'EXECUTE') THEN
    RAISE EXCEPTION 'anon can execute is_admin';
  END IF;
  INSERT INTO admin_01a_results VALUES ('anon has no administrative function access', true, 'no execute');

  PERFORM set_config('request.jwt.claim.sub', v_customer_id::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT count(*) INTO v_count
  FROM public.products
  WHERE id = ANY (ARRAY[v_public_id, v_partial_id, v_test_id, v_prueba_id, v_inactive_id]);
  EXECUTE 'RESET ROLE';
  IF v_count <> 2 THEN RAISE EXCEPTION 'customer expected two public fixtures, got %', v_count; END IF;
  INSERT INTO admin_01a_results VALUES ('customer reads only public catalogue fixtures', true, '2 rows');

  v_denied := false;
  EXECUTE 'SET LOCAL ROLE authenticated';
  BEGIN
    INSERT INTO public.products (id, name, description, category, price, is_featured, display_order, is_active)
    VALUES (gen_random_uuid(), 'Forbidden customer insert', '', 'Ortopedia', 100, false, 0, true);
  EXCEPTION WHEN insufficient_privilege THEN
    v_denied := true;
  END;
  EXECUTE 'RESET ROLE';
  IF NOT v_denied THEN RAISE EXCEPTION 'customer inserted a product'; END IF;
  INSERT INTO admin_01a_results VALUES ('customer cannot insert products', true, 'denied');

  v_denied := false;
  EXECUTE 'SET LOCAL ROLE authenticated';
  BEGIN
    UPDATE public.products SET name = 'Forbidden customer update' WHERE id = v_public_id;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    v_denied := v_count = 0;
  EXCEPTION WHEN insufficient_privilege THEN
    v_denied := true;
  END;
  EXECUTE 'RESET ROLE';
  IF NOT v_denied THEN RAISE EXCEPTION 'customer updated a product'; END IF;
  INSERT INTO admin_01a_results VALUES ('customer cannot update products', true, 'denied');

  v_denied := false;
  EXECUTE 'SET LOCAL ROLE authenticated';
  BEGIN
    DELETE FROM public.products WHERE id = v_public_id;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    v_denied := v_count = 0;
  EXCEPTION WHEN insufficient_privilege THEN
    v_denied := true;
  END;
  EXECUTE 'RESET ROLE';
  IF NOT v_denied THEN RAISE EXCEPTION 'customer deleted a product'; END IF;
  INSERT INTO admin_01a_results VALUES ('customer cannot delete products', true, 'denied');

  v_denied := false;
  EXECUTE 'SET LOCAL ROLE authenticated';
  BEGIN
    UPDATE public.settings SET value = '{"forbidden":true}'::jsonb WHERE key = v_private_key;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    v_denied := v_count = 0;
  EXCEPTION WHEN insufficient_privilege THEN
    v_denied := true;
  END;
  EXECUTE 'RESET ROLE';
  IF NOT v_denied THEN RAISE EXCEPTION 'customer updated a private setting'; END IF;
  INSERT INTO admin_01a_results VALUES ('customer cannot update administrative settings', true, 'denied');

  v_denied := false;
  EXECUTE 'SET LOCAL ROLE authenticated';
  BEGIN
    UPDATE public.profiles SET role = 'admin' WHERE id = v_customer_id;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    v_denied := v_count = 0;
  EXCEPTION WHEN insufficient_privilege THEN
    v_denied := true;
  END;
  EXECUTE 'RESET ROLE';
  IF NOT v_denied THEN RAISE EXCEPTION 'customer changed its own role'; END IF;
  INSERT INTO admin_01a_results VALUES ('customer cannot modify its own role', true, 'denied');

  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT public.is_admin() INTO v_is_admin;
  EXECUTE 'RESET ROLE';
  IF v_is_admin THEN RAISE EXCEPTION 'customer resolved as admin'; END IF;
  INSERT INTO admin_01a_results VALUES ('customer does not resolve as admin', true, 'false');

  PERFORM set_config('request.jwt.claim.sub', v_admin_id::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT count(*) INTO v_count
  FROM public.products
  WHERE id = ANY (ARRAY[v_public_id, v_partial_id, v_test_id, v_prueba_id, v_inactive_id]);
  EXECUTE 'RESET ROLE';
  IF v_count <> 5 THEN RAISE EXCEPTION 'admin lost read-all product access, got %', v_count; END IF;
  INSERT INTO admin_01a_results VALUES ('admin retains read-all product access', true, '5 rows');

  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT count(*) INTO v_count FROM public.settings WHERE key = v_private_key;
  EXECUTE 'RESET ROLE';
  IF v_count <> 1 THEN RAISE EXCEPTION 'admin cannot read private setting'; END IF;
  INSERT INTO admin_01a_results VALUES ('admin retains private settings read access', true, '1 row');

  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT public.is_admin() INTO v_is_admin;
  EXECUTE 'RESET ROLE';
  IF NOT v_is_admin THEN RAISE EXCEPTION 'synthetic admin did not resolve as admin'; END IF;
  INSERT INTO admin_01a_results VALUES ('admin role is enforced by database identity', true, 'true');

  -- ADMIN-01B (202609230201_admin_01b_admin_boundary.sql) revokes direct
  -- authenticated INSERT/UPDATE/DELETE on products/settings and replaces them
  -- with narrow, audited RPCs. The four checks below therefore now assert the
  -- opposite of what ADMIN-01A originally recorded: admin mutation only
  -- happens through admin_create_product/admin_update_product/
  -- admin_set_product_active/admin_upsert_settings_document, exercised in
  -- supabase/tests/admin_01b_admin_boundary.sql. Physical deletion of
  -- products was removed entirely by ADMIN-01B, so no replacement RPC exists
  -- for the old "admin retains expected product delete" case.

  v_denied := false;
  EXECUTE 'SET LOCAL ROLE authenticated';
  BEGIN
    INSERT INTO public.products (
      id, name, description, category, price, is_featured, display_order,
      is_active, currency, track_stock, allow_backorder, stock_on_hand,
      low_stock_threshold
    ) VALUES (
      v_admin_product_id, 'ADMIN-01A admin fixture', 'Fixture sintetico local',
      'Ortopedia', 100, false, 10, false, 'ARS', true, false, 0, 0
    );
  EXCEPTION WHEN insufficient_privilege THEN
    v_denied := true;
  END;
  EXECUTE 'RESET ROLE';
  IF NOT v_denied THEN RAISE EXCEPTION 'admin inserted a product directly after ADMIN-01B revoked that grant'; END IF;
  INSERT INTO admin_01a_results VALUES ('admin direct product insert is revoked (superseded by ADMIN-01B)', true, 'denied');

  v_denied := false;
  EXECUTE 'SET LOCAL ROLE authenticated';
  BEGIN
    UPDATE public.products SET name = 'ADMIN-01A admin fixture updated' WHERE id = v_public_id;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    v_denied := v_count = 0;
  EXCEPTION WHEN insufficient_privilege THEN
    v_denied := true;
  END;
  EXECUTE 'RESET ROLE';
  IF NOT v_denied THEN RAISE EXCEPTION 'admin updated a product directly after ADMIN-01B revoked that grant'; END IF;
  INSERT INTO admin_01a_results VALUES ('admin direct product update is revoked (superseded by ADMIN-01B)', true, 'denied');

  v_denied := false;
  EXECUTE 'SET LOCAL ROLE authenticated';
  BEGIN
    DELETE FROM public.products WHERE id = v_public_id;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    v_denied := v_count = 0;
  EXCEPTION WHEN insufficient_privilege THEN
    v_denied := true;
  END;
  EXECUTE 'RESET ROLE';
  IF NOT v_denied THEN RAISE EXCEPTION 'admin deleted a product directly after ADMIN-01B revoked that grant'; END IF;
  INSERT INTO admin_01a_results VALUES ('admin direct product delete is revoked (superseded by ADMIN-01B)', true, 'denied');

  v_denied := false;
  EXECUTE 'SET LOCAL ROLE authenticated';
  BEGIN
    UPDATE public.settings SET value = '{"scope":"admin-updated-local"}'::jsonb WHERE key = v_private_key;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    v_denied := v_count = 0;
  EXCEPTION WHEN insufficient_privilege THEN
    v_denied := true;
  END;
  EXECUTE 'RESET ROLE';
  IF NOT v_denied THEN RAISE EXCEPTION 'admin updated settings directly after ADMIN-01B revoked that grant'; END IF;
  INSERT INTO admin_01a_results VALUES ('admin direct settings update is revoked (superseded by ADMIN-01B)', true, 'denied');

  IF pg_has_role('authenticated', 'service_role', 'MEMBER')
     OR has_table_privilege('authenticated', 'public.orders', 'INSERT')
     OR has_table_privilege('authenticated', 'public.orders', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.orders', 'DELETE') THEN
    RAISE EXCEPTION 'authenticated role gained service or commerce mutation privileges';
  END IF;
  INSERT INTO admin_01a_results VALUES ('admin gains no service-role or order mutation privileges', true, 'none');

  SELECT count(*) INTO v_count
  FROM pg_class AS c
  JOIN pg_namespace AS n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relname = ANY (ARRAY['profiles', 'products', 'settings'])
    AND c.relrowsecurity
    AND c.relforcerowsecurity;
  IF v_count <> 3 THEN RAISE EXCEPTION 'expected forced RLS on three admin tables, got %', v_count; END IF;
  INSERT INTO admin_01a_results VALUES ('admin tables keep enabled and forced RLS', true, '3 tables');
END
$$;

SELECT test_name, ok, detail
FROM admin_01a_results
ORDER BY test_name;

SELECT count(*) AS assertions, bool_and(ok) AS all_passed
FROM admin_01a_results;

ROLLBACK;
