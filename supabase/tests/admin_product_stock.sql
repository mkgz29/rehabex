\set ON_ERROR_STOP on

BEGIN;

CREATE TEMP TABLE admin_product_stock_results (
  test_name text PRIMARY KEY,
  ok boolean NOT NULL,
  detail text
);

DO $$
DECLARE
  v_admin_id uuid := gen_random_uuid();
  v_product public.products;
  v_updated jsonb;
  v_count integer;
  v_denied boolean;
  v_sqlstate text;
BEGIN
  INSERT INTO auth.users (id, aud, role, email, created_at, updated_at)
  VALUES (v_admin_id, 'authenticated', 'authenticated', 'admin-stock-test@example.test', now(), now());
  UPDATE public.profiles SET role = 'admin' WHERE id = v_admin_id;

  PERFORM set_config('request.jwt.claim.sub', v_admin_id::text, true);

  -- Old signatures are fully gone: no overload ambiguity, no leftover -------

  IF to_regprocedure('public.admin_create_product(text, text, text, numeric, text, boolean, integer, uuid)') IS NOT NULL THEN
    RAISE EXCEPTION 'the pre-stock admin_create_product signature still exists';
  END IF;
  INSERT INTO admin_product_stock_results VALUES ('the old (pre-stock) admin_create_product signature no longer exists', true, 'dropped');

  IF to_regprocedure('public.admin_update_product(uuid, text, text, text, numeric, text, boolean, integer, timestamptz, uuid)') IS NOT NULL THEN
    RAISE EXCEPTION 'the pre-stock admin_update_product signature still exists';
  END IF;
  INSERT INTO admin_product_stock_results VALUES ('the old (pre-stock) admin_update_product signature no longer exists', true, 'dropped');

  SELECT count(*) INTO v_count FROM pg_proc WHERE proname = 'admin_create_product' AND pronamespace = 'public'::regnamespace;
  IF v_count <> 1 THEN RAISE EXCEPTION 'admin_create_product has % overloads, expected exactly 1', v_count; END IF;
  INSERT INTO admin_product_stock_results VALUES ('admin_create_product has exactly one signature (no accidental overload)', true, '1');

  SELECT count(*) INTO v_count FROM pg_proc WHERE proname = 'admin_update_product' AND pronamespace = 'public'::regnamespace;
  IF v_count <> 1 THEN RAISE EXCEPTION 'admin_update_product has % overloads, expected exactly 1', v_count; END IF;
  INSERT INTO admin_product_stock_results VALUES ('admin_update_product has exactly one signature (no accidental overload)', true, '1');

  -- Create: stock_on_hand is required, >= 0 ----------------------------------

  v_denied := false;
  EXECUTE 'SET LOCAL ROLE authenticated';
  BEGIN
    PERFORM public.admin_create_product_with_media('Stock test product', 'desc', 'Ortopedia', 100, false, 0, NULL, false, '[]'::jsonb, gen_random_uuid());
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE;
    v_denied := v_sqlstate = 'ADM22';
  END;
  EXECUTE 'RESET ROLE';
  IF NOT v_denied THEN RAISE EXCEPTION 'a NULL stock_on_hand was accepted on create'; END IF;
  INSERT INTO admin_product_stock_results VALUES ('create: a NULL stock_on_hand is rejected', true, 'ADM22');

  v_denied := false;
  EXECUTE 'SET LOCAL ROLE authenticated';
  BEGIN
    PERFORM public.admin_create_product_with_media('Stock test product', 'desc', 'Ortopedia', 100, false, 0, -1, false, '[]'::jsonb, gen_random_uuid());
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE;
    v_denied := v_sqlstate = 'ADM22';
  END;
  EXECUTE 'RESET ROLE';
  IF NOT v_denied THEN RAISE EXCEPTION 'a negative stock_on_hand was accepted on create'; END IF;
  INSERT INTO admin_product_stock_results VALUES ('create: a negative stock_on_hand is rejected', true, 'ADM22');

  -- Create: stock_on_hand = 0 is explicitly allowed (sold out on arrival) --

  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT (public.admin_create_product_with_media('Stock zero product', 'desc', 'Ortopedia', 100, false, 0, 0, false, '[]'::jsonb, gen_random_uuid())->'product')::jsonb INTO v_updated;
  EXECUTE 'RESET ROLE';
  IF (v_updated->>'stock_on_hand')::integer <> 0 THEN RAISE EXCEPTION 'stock_on_hand=0 was not stored as 0'; END IF;
  INSERT INTO admin_product_stock_results VALUES ('create: stock_on_hand=0 is accepted and stored', true, 'stock_on_hand=0');

  -- Create: a real stock value round-trips through the RPC ------------------

  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT (public.admin_create_product_with_media('Stock five product', 'desc', 'Ortopedia', 100, false, 0, 5, false, '[]'::jsonb, gen_random_uuid())->'product')::jsonb INTO v_updated;
  EXECUTE 'RESET ROLE';
  IF (v_updated->>'stock_on_hand')::integer <> 5 THEN RAISE EXCEPTION 'stock_on_hand=5 was not stored as 5'; END IF;
  INSERT INTO admin_product_stock_results VALUES ('create: admin_create_product_with_media saves the real stock_on_hand value', true, 'stock_on_hand=5');

  SELECT * INTO v_product FROM public.products WHERE id = (v_updated->>'id')::uuid;
  IF v_product.stock_on_hand <> 5 THEN RAISE EXCEPTION 'products.stock_on_hand does not match what the RPC returned'; END IF;
  INSERT INTO admin_product_stock_results VALUES ('the real products.stock_on_hand column matches the RPC response', true, '5');

  -- Update: changes stock_on_hand, rejects invalid values --------------------

  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT (public.admin_update_product_with_media(v_product.id, v_product.name, v_product.description, v_product.category, v_product.price, v_product.is_featured, v_product.display_order, 12, v_product.is_active, '[]'::jsonb, v_product.updated_at, gen_random_uuid())->'product')::jsonb INTO v_updated;
  EXECUTE 'RESET ROLE';
  IF (v_updated->>'stock_on_hand')::integer <> 12 THEN RAISE EXCEPTION 'update did not change stock_on_hand to 12'; END IF;
  INSERT INTO admin_product_stock_results VALUES ('update: admin_update_product_with_media changes stock_on_hand', true, 'stock_on_hand=12');

  SELECT * INTO v_product FROM public.products WHERE id = v_product.id;

  v_denied := false;
  EXECUTE 'SET LOCAL ROLE authenticated';
  BEGIN
    PERFORM public.admin_update_product_with_media(v_product.id, v_product.name, v_product.description, v_product.category, v_product.price, v_product.is_featured, v_product.display_order, -3, v_product.is_active, '[]'::jsonb, v_product.updated_at, gen_random_uuid());
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE;
    v_denied := v_sqlstate = 'ADM22';
  END;
  EXECUTE 'RESET ROLE';
  IF NOT v_denied THEN RAISE EXCEPTION 'update accepted a negative stock_on_hand'; END IF;
  INSERT INTO admin_product_stock_results VALUES ('update: a negative stock_on_hand is rejected', true, 'ADM22');

  SELECT count(*) INTO v_count FROM public.products WHERE id = v_product.id AND stock_on_hand = -3;
  IF v_count <> 0 THEN RAISE EXCEPTION 'the rejected negative stock update applied anyway'; END IF;
  INSERT INTO admin_product_stock_results VALUES ('a rejected stock update changes nothing', true, '0 rows');

  -- Update: setting stock back to 0 (sold out) is allowed --------------------

  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT (public.admin_update_product_with_media(v_product.id, v_product.name, v_product.description, v_product.category, v_product.price, v_product.is_featured, v_product.display_order, 0, v_product.is_active, '[]'::jsonb, v_product.updated_at, gen_random_uuid())->'product')::jsonb INTO v_updated;
  EXECUTE 'RESET ROLE';
  IF (v_updated->>'stock_on_hand')::integer <> 0 THEN RAISE EXCEPTION 'update did not accept stock_on_hand=0'; END IF;
  INSERT INTO admin_product_stock_results VALUES ('update: stock_on_hand can be set back to 0', true, 'stock_on_hand=0');

  -- The raw CHECK constraint on products.stock_on_hand is still enforced
  -- independently of the RPC's own validation (defense in depth) -----------

  v_denied := false;
  BEGIN
    UPDATE public.products SET stock_on_hand = -1 WHERE id = v_product.id;
  EXCEPTION WHEN check_violation THEN
    v_denied := true;
  END;
  IF NOT v_denied THEN RAISE EXCEPTION 'products_stock_on_hand_nonnegative_check did not reject a negative value'; END IF;
  INSERT INTO admin_product_stock_results VALUES ('the raw stock_on_hand CHECK constraint still rejects negative values', true, 'check_violation');

  -- Grants: anon/service_role still excluded, authenticated still allowed ---

  IF has_function_privilege('anon', 'public.admin_create_product_with_media(text, text, text, numeric, boolean, integer, integer, boolean, jsonb, uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.admin_update_product_with_media(uuid, text, text, text, numeric, boolean, integer, integer, boolean, jsonb, timestamptz, uuid)', 'EXECUTE')
     OR has_function_privilege('service_role', 'public.admin_create_product_with_media(text, text, text, numeric, boolean, integer, integer, boolean, jsonb, uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'anon or service_role can execute a product RPC after the stock migration';
  END IF;
  INSERT INTO admin_product_stock_results VALUES ('anon/service_role still have no execute on the product RPCs', true, 'no execute');

  IF NOT has_function_privilege('authenticated', 'public.admin_create_product_with_media(text, text, text, numeric, boolean, integer, integer, boolean, jsonb, uuid)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.admin_update_product_with_media(uuid, text, text, text, numeric, boolean, integer, integer, boolean, jsonb, timestamptz, uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'authenticated lost execute on a product RPC after the stock migration';
  END IF;
  INSERT INTO admin_product_stock_results VALUES ('authenticated still has execute on both product RPCs', true, 'execute granted');

  -- RLS on products is untouched by this migration ---------------------------

  SELECT count(*) INTO v_count
  FROM pg_class AS c
  JOIN pg_namespace AS n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relname = 'products' AND c.relrowsecurity;
  IF v_count <> 1 THEN RAISE EXCEPTION 'products lost its RLS flag after the stock migration'; END IF;
  INSERT INTO admin_product_stock_results VALUES ('products keeps its RLS configuration after the stock migration', true, '1 table');

  -- Audit trail: stock_on_hand is recorded in the before/after state --------

  SELECT count(*) INTO v_count FROM public.admin_audit_events WHERE entity_id = v_product.id::text AND action = 'product.updated' AND (after_state->>'stock_on_hand') IS NOT NULL;
  IF v_count = 0 THEN RAISE EXCEPTION 'stock_on_hand changes were not captured in the audit trail'; END IF;
  INSERT INTO admin_product_stock_results VALUES ('stock_on_hand changes are captured in admin_audit_events', true, format('%s rows', v_count));
END
$$;

SELECT test_name, ok, detail
FROM admin_product_stock_results
ORDER BY test_name;

SELECT count(*) AS assertions, bool_and(ok) AS all_passed
FROM admin_product_stock_results;

ROLLBACK;
