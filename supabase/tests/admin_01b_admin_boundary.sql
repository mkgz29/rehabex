\set ON_ERROR_STOP on

BEGIN;

CREATE TEMP TABLE admin_01b_results (
  test_name text PRIMARY KEY,
  ok boolean NOT NULL,
  detail text
);

DO $$
DECLARE
  v_customer_id uuid := gen_random_uuid();
  v_admin_id uuid := gen_random_uuid();
  v_product public.products;
  v_updated public.products;
  v_legacy_test public.products;
  v_hero_created public.settings;
  v_hero_updated public.settings;
  v_count integer;
  v_denied boolean;
  v_sqlstate text;
  v_stale_updated_at timestamptz;
  v_frozen_category text;
  v_frozen_name text;
  v_noop_request_id uuid;
BEGIN
  INSERT INTO auth.users (id, aud, role, email, created_at, updated_at)
  VALUES
    (v_customer_id, 'authenticated', 'authenticated', 'admin-01b-customer@example.test', now(), now()),
    (v_admin_id, 'authenticated', 'authenticated', 'admin-01b-admin@example.test', now(), now());

  UPDATE public.profiles SET role = 'admin' WHERE id = v_admin_id;

  -- A pre-existing TEST-category product, inserted directly as it would exist
  -- from before this boundary (see ADMIN-00: three such products remain in
  -- production). It must never become activatable through the RPC.
  INSERT INTO public.products (id, name, description, category, price, is_featured, display_order, is_active)
  VALUES (gen_random_uuid(), 'ADMIN-01B legacy TEST fixture', '', 'TEST', 100, false, 0, false)
  RETURNING * INTO v_legacy_test;

  -- anon: no execute grant, no direct table grants, no audit read ----------

  IF has_function_privilege('anon', 'public.admin_create_product(text, text, text, numeric, text, boolean, integer, uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'anon can execute admin_create_product';
  END IF;
  INSERT INTO admin_01b_results VALUES ('anon has no execute on admin_create_product', true, 'no execute');

  IF has_table_privilege('anon', 'public.products', 'INSERT')
     OR has_table_privilege('anon', 'public.products', 'UPDATE')
     OR has_table_privilege('anon', 'public.products', 'DELETE') THEN
    RAISE EXCEPTION 'anon retains direct product mutation grants';
  END IF;
  INSERT INTO admin_01b_results VALUES ('anon has no direct product mutation grants', true, 'no grants');

  v_denied := false;
  EXECUTE 'SET LOCAL ROLE anon';
  BEGIN
    SELECT count(*) INTO v_count FROM public.admin_audit_events;
  EXCEPTION WHEN insufficient_privilege THEN
    v_denied := true;
  END;
  EXECUTE 'RESET ROLE';
  IF NOT v_denied THEN RAISE EXCEPTION 'anon read audit events'; END IF;
  INSERT INTO admin_01b_results VALUES ('anon cannot read audit events', true, 'denied');

  -- authenticated non-admin: RPC executes but is refused internally --------

  PERFORM set_config('request.jwt.claim.sub', v_customer_id::text, true);

  v_denied := false;
  EXECUTE 'SET LOCAL ROLE authenticated';
  BEGIN
    PERFORM public.admin_create_product('Forbidden customer product', '', 'Ortopedia', 100, NULL, false, 0, gen_random_uuid());
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE;
    v_denied := v_sqlstate = 'ADM03';
  END;
  EXECUTE 'RESET ROLE';
  IF NOT v_denied THEN RAISE EXCEPTION 'customer was not refused by admin_create_product'; END IF;
  INSERT INTO admin_01b_results VALUES ('customer RPC call is refused with forbidden', true, 'ADM03');

  v_denied := false;
  EXECUTE 'SET LOCAL ROLE authenticated';
  BEGIN
    INSERT INTO public.products (id, name, description, category, price, is_featured, display_order, is_active)
    VALUES (gen_random_uuid(), 'Forbidden customer direct insert', '', 'Ortopedia', 100, false, 0, true);
  EXCEPTION WHEN insufficient_privilege THEN
    v_denied := true;
  END;
  EXECUTE 'RESET ROLE';
  IF NOT v_denied THEN RAISE EXCEPTION 'customer inserted a product directly'; END IF;
  INSERT INTO admin_01b_results VALUES ('customer cannot insert products directly', true, 'denied');

  v_denied := false;
  EXECUTE 'SET LOCAL ROLE authenticated';
  BEGIN
    INSERT INTO public.admin_audit_events (actor_id, action, entity_type, request_id)
    VALUES (v_customer_id, 'product.created', 'product', gen_random_uuid());
  EXCEPTION WHEN insufficient_privilege THEN
    v_denied := true;
  END;
  EXECUTE 'RESET ROLE';
  IF NOT v_denied THEN RAISE EXCEPTION 'customer inserted an audit event directly'; END IF;
  INSERT INTO admin_01b_results VALUES ('customer cannot insert audit events directly', true, 'denied');

  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT count(*) INTO v_count FROM public.admin_audit_events;
  EXECUTE 'RESET ROLE';
  IF v_count <> 0 THEN RAISE EXCEPTION 'customer read audit events'; END IF;
  INSERT INTO admin_01b_results VALUES ('customer cannot read audit events', true, '0 rows');

  -- admin: direct DML is gone, only the RPCs remain -------------------------

  PERFORM set_config('request.jwt.claim.sub', v_admin_id::text, true);

  v_denied := false;
  EXECUTE 'SET LOCAL ROLE authenticated';
  BEGIN
    INSERT INTO public.products (id, name, description, category, price, is_featured, display_order, is_active)
    VALUES (gen_random_uuid(), 'Forbidden admin direct insert', '', 'Ortopedia', 100, false, 0, true);
  EXCEPTION WHEN insufficient_privilege THEN
    v_denied := true;
  END;
  EXECUTE 'RESET ROLE';
  IF NOT v_denied THEN RAISE EXCEPTION 'admin inserted a product directly, bypassing the RPC boundary'; END IF;
  INSERT INTO admin_01b_results VALUES ('admin cannot insert products directly', true, 'denied');

  v_denied := false;
  EXECUTE 'SET LOCAL ROLE authenticated';
  BEGIN
    UPDATE public.settings SET value = '{"bypass":true}'::jsonb WHERE key = 'hero_content';
    GET DIAGNOSTICS v_count = ROW_COUNT;
    v_denied := v_count = 0;
  EXCEPTION WHEN insufficient_privilege THEN
    v_denied := true;
  END;
  EXECUTE 'RESET ROLE';
  IF NOT v_denied THEN RAISE EXCEPTION 'admin updated settings directly, bypassing the RPC boundary'; END IF;
  INSERT INTO admin_01b_results VALUES ('admin cannot update settings directly', true, 'denied');

  -- admin: create -> inactive by default, audited exactly once --------------

  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT * FROM public.admin_create_product('ADMIN-01B fixture', 'Fixture sintetico local', 'Ortopedia', 150, NULL, false, 0, gen_random_uuid()) INTO v_product;
  EXECUTE 'RESET ROLE';
  IF v_product.is_active THEN RAISE EXCEPTION 'created product is active by default'; END IF;
  INSERT INTO admin_01b_results VALUES ('admin creates an inactive product via RPC', true, 'is_active=false');

  SELECT count(*) INTO v_count FROM public.admin_audit_events WHERE entity_id = v_product.id::text AND action = 'product.created';
  IF v_count <> 1 THEN RAISE EXCEPTION 'product.created audit event missing'; END IF;
  INSERT INTO admin_01b_results VALUES ('product creation is audited exactly once', true, '1 row');

  -- New products cannot be created with a reserved category -----------------

  v_denied := false;
  BEGIN
    PERFORM public.admin_create_product('Forbidden TEST creation', '', 'TEST', 100, NULL, false, 0, gen_random_uuid());
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE;
    v_denied := v_sqlstate = 'ADM22';
  END;
  IF NOT v_denied THEN RAISE EXCEPTION 'a new TEST-category product was created'; END IF;
  INSERT INTO admin_01b_results VALUES ('new products reject a reserved category', true, 'ADM22');

  -- admin: activate a valid product ------------------------------------------

  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT * FROM public.admin_set_product_active(v_product.id, true, v_product.updated_at, gen_random_uuid()) INTO v_product;
  EXECUTE 'RESET ROLE';
  IF NOT v_product.is_active THEN RAISE EXCEPTION 'activation did not take effect'; END IF;
  INSERT INTO admin_01b_results VALUES ('admin activates a valid product via RPC', true, 'is_active=true');

  SELECT count(*) INTO v_count FROM public.admin_audit_events WHERE entity_id = v_product.id::text AND action = 'product.activated';
  IF v_count <> 1 THEN RAISE EXCEPTION 'product.activated audit event missing'; END IF;
  INSERT INTO admin_01b_results VALUES ('activation is audited exactly once', true, '1 row');

  -- A legacy TEST-category product cannot be activated -----------------------

  v_denied := false;
  BEGIN
    PERFORM public.admin_set_product_active(v_legacy_test.id, true, v_legacy_test.updated_at, gen_random_uuid());
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE;
    v_denied := v_sqlstate = 'ADM22';
  END;
  IF NOT v_denied THEN RAISE EXCEPTION 'a legacy TEST-category product was activated'; END IF;
  INSERT INTO admin_01b_results VALUES ('a legacy TEST-category product cannot be activated', true, 'ADM22');

  -- Editing an active product into a reserved category is refused -----------

  v_frozen_category := v_product.category;
  v_denied := false;
  BEGIN
    PERFORM public.admin_update_product(v_product.id, v_product.name, v_product.description, 'TEST', v_product.price, v_product.image_url, v_product.is_featured, v_product.display_order, v_product.updated_at, gen_random_uuid());
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE;
    v_denied := v_sqlstate = 'ADM22';
  END;
  IF NOT v_denied THEN RAISE EXCEPTION 'an active product was edited into a reserved category'; END IF;
  SELECT * INTO v_product FROM public.products WHERE id = v_product.id;
  IF v_product.category <> v_frozen_category THEN RAISE EXCEPTION 'the rejected category edit changed the row anyway'; END IF;
  INSERT INTO admin_01b_results VALUES ('editing an active product into a reserved category is refused', true, 'ADM22');

  -- admin: deactivate is reversible -------------------------------------------

  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT * FROM public.admin_set_product_active(v_product.id, false, v_product.updated_at, gen_random_uuid()) INTO v_product;
  EXECUTE 'RESET ROLE';
  IF v_product.is_active THEN RAISE EXCEPTION 'deactivation did not take effect'; END IF;
  INSERT INTO admin_01b_results VALUES ('admin deactivates a product via RPC (reversible)', true, 'is_active=false');

  -- Editing category into TEST is unrestricted once the product is inactive -

  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT * FROM public.admin_update_product(v_product.id, v_product.name, v_product.description, 'TEST', v_product.price, v_product.image_url, v_product.is_featured, v_product.display_order, v_product.updated_at, gen_random_uuid()) INTO v_product;
  EXECUTE 'RESET ROLE';
  IF v_product.category <> 'TEST' THEN RAISE EXCEPTION 'an inactive product could not be edited into a TEST category'; END IF;
  INSERT INTO admin_01b_results VALUES ('editing an inactive product into TEST is unrestricted', true, 'category=TEST');

  -- Revert to a normal category before the remaining edit assertions --------

  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT * FROM public.admin_update_product(v_product.id, v_product.name, v_product.description, 'Ortopedia', v_product.price, v_product.image_url, v_product.is_featured, v_product.display_order, v_product.updated_at, gen_random_uuid()) INTO v_product;
  EXECUTE 'RESET ROLE';

  -- No-op update: identical values leave updated_at and audit trail untouched

  v_stale_updated_at := v_product.updated_at;
  v_noop_request_id := gen_random_uuid();
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT * FROM public.admin_update_product(v_product.id, v_product.name, v_product.description, v_product.category, v_product.price, v_product.image_url, v_product.is_featured, v_product.display_order, v_product.updated_at, v_noop_request_id) INTO v_updated;
  EXECUTE 'RESET ROLE';
  IF v_updated.updated_at <> v_stale_updated_at THEN RAISE EXCEPTION 'a no-op edit bumped updated_at'; END IF;
  SELECT count(*) INTO v_count FROM public.admin_audit_events WHERE request_id = v_noop_request_id;
  IF v_count <> 0 THEN RAISE EXCEPTION 'a no-op edit produced a misleading audit event'; END IF;
  INSERT INTO admin_01b_results VALUES ('no-op edits do not create audit events or bump updated_at', true, '0 rows');

  -- Price change: audited with a distinct action and the new price ----------

  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT * FROM public.admin_update_product(v_product.id, v_product.name, v_product.description, v_product.category, v_product.price + 25, v_product.image_url, v_product.is_featured, v_product.display_order, v_stale_updated_at, gen_random_uuid()) INTO v_updated;
  EXECUTE 'RESET ROLE';

  SELECT count(*) INTO v_count
  FROM public.admin_audit_events
  WHERE entity_id = v_product.id::text
    AND action = 'product.price_changed'
    AND (before_state->>'price')::numeric = v_product.price
    AND (after_state->>'price')::numeric = v_updated.price;
  IF v_count <> 1 THEN RAISE EXCEPTION 'price change was not audited with the correct before/after values'; END IF;
  INSERT INTO admin_01b_results VALUES ('price changes are audited with before/after values', true, '1 row');

  -- Optimistic concurrency: a mismatched expected_updated_at is rejected.
  -- A real "two sessions race" scenario is exercised by the API-level
  -- concurrency tests instead: now() is transaction-frozen inside this single
  -- psql transaction, so two real writes here would carry the same
  -- timestamp. Supplying a value that provably does not match the stored row
  -- exercises the exact same comparison the RPC performs against a genuinely
  -- stale client.

  v_frozen_name := v_updated.name;
  v_denied := false;
  EXECUTE 'SET LOCAL ROLE authenticated';
  BEGIN
    PERFORM public.admin_update_product(v_updated.id, 'Stale writer', v_updated.description, v_updated.category, v_updated.price, v_updated.image_url, v_updated.is_featured, v_updated.display_order, v_updated.updated_at - interval '1 second', gen_random_uuid());
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE;
    v_denied := v_sqlstate = 'ADM09';
  END;
  EXECUTE 'RESET ROLE';
  IF NOT v_denied THEN RAISE EXCEPTION 'a stale version was accepted instead of rejected with a conflict'; END IF;
  INSERT INTO admin_01b_results VALUES ('stale expected_updated_at is rejected with version_conflict', true, 'ADM09');

  SELECT count(*) INTO v_count FROM public.products WHERE id = v_updated.id AND name = v_frozen_name;
  IF v_count <> 1 THEN RAISE EXCEPTION 'the rejected concurrent write changed the row anyway'; END IF;
  SELECT count(*) INTO v_count FROM public.admin_audit_events WHERE after_state->>'name' = 'Stale writer';
  IF v_count <> 0 THEN RAISE EXCEPTION 'the rejected write left a misleading success audit event'; END IF;
  INSERT INTO admin_01b_results VALUES ('a rejected concurrent write changes nothing and audits nothing', true, '0 rows');

  -- Correct current version is accepted after a conflict --------------------

  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT * FROM public.admin_update_product(v_updated.id, 'Winner writer', v_updated.description, v_updated.category, v_updated.price, v_updated.image_url, v_updated.is_featured, v_updated.display_order, v_updated.updated_at, gen_random_uuid()) INTO v_updated;
  EXECUTE 'RESET ROLE';
  IF v_updated.name <> 'Winner writer' THEN RAISE EXCEPTION 'the correctly versioned write was not applied'; END IF;
  INSERT INTO admin_01b_results VALUES ('the correctly versioned write is applied after a conflict', true, 'name=Winner writer');

  -- Unknown product id: not_found --------------------------------------------

  v_denied := false;
  EXECUTE 'SET LOCAL ROLE authenticated';
  BEGIN
    PERFORM public.admin_update_product(gen_random_uuid(), 'x', '', 'Ortopedia', 1, NULL, false, 0, now(), gen_random_uuid());
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE;
    v_denied := v_sqlstate = 'ADM04';
  END;
  EXECUTE 'RESET ROLE';
  IF NOT v_denied THEN RAISE EXCEPTION 'updating a nonexistent product did not raise not_found'; END IF;
  INSERT INTO admin_01b_results VALUES ('updating an unknown product raises not_found', true, 'ADM04');

  -- Hero settings: creation is distinguished from update, keys are allowlisted

  DELETE FROM public.settings WHERE key = 'hero_content';

  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT * FROM public.admin_upsert_settings_document('hero_content', '{"title":"Uno"}'::jsonb, NULL, gen_random_uuid()) INTO v_hero_created;
  EXECUTE 'RESET ROLE';
  SELECT count(*) INTO v_count FROM public.admin_audit_events WHERE entity_type = 'settings' AND entity_id = 'hero_content' AND before_state IS NULL AND action = 'hero.updated';
  IF v_count <> 1 THEN RAISE EXCEPTION 'hero creation was not audited with a null before_state'; END IF;
  INSERT INTO admin_01b_results VALUES ('first hero save is audited as a creation', true, 'before_state=null');

  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT * FROM public.admin_upsert_settings_document('hero_content', '{"title":"Dos"}'::jsonb, v_hero_created.updated_at, gen_random_uuid()) INTO v_hero_updated;
  EXECUTE 'RESET ROLE';
  IF v_hero_updated.value->>'title' <> 'Dos' THEN RAISE EXCEPTION 'hero update did not apply'; END IF;
  INSERT INTO admin_01b_results VALUES ('hero update via RPC applies the new value', true, 'title=Dos');

  -- A mismatched hero version is rejected (see the concurrency note above:
  -- now() is transaction-frozen here, so a deliberately wrong timestamp
  -- exercises the same comparison a genuinely stale client would trigger).

  v_denied := false;
  EXECUTE 'SET LOCAL ROLE authenticated';
  BEGIN
    PERFORM public.admin_upsert_settings_document('hero_content', '{"title":"Tres"}'::jsonb, v_hero_updated.updated_at - interval '1 second', gen_random_uuid());
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE;
    v_denied := v_sqlstate = 'ADM09';
  END;
  EXECUTE 'RESET ROLE';
  IF NOT v_denied THEN RAISE EXCEPTION 'a stale hero version was accepted'; END IF;
  INSERT INTO admin_01b_results VALUES ('a stale hero version is rejected with version_conflict', true, 'ADM09');

  -- Unknown settings keys are rejected ----------------------------------------

  v_denied := false;
  EXECUTE 'SET LOCAL ROLE authenticated';
  BEGIN
    PERFORM public.admin_upsert_settings_document('commerce_shipping', '{"amount":0}'::jsonb, NULL, gen_random_uuid());
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE;
    v_denied := v_sqlstate = 'ADM22';
  END;
  EXECUTE 'RESET ROLE';
  IF NOT v_denied THEN RAISE EXCEPTION 'an unknown settings key was accepted'; END IF;
  INSERT INTO admin_01b_results VALUES ('unknown settings keys are rejected', true, 'ADM22');

  -- Function grants: anon has no execute on any admin RPC --------------------

  IF has_function_privilege('anon', 'public.admin_upsert_settings_document(text, jsonb, timestamptz, uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.admin_update_product(uuid, text, text, text, numeric, text, boolean, integer, timestamptz, uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.admin_set_product_active(uuid, boolean, timestamptz, uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'anon can execute an admin RPC';
  END IF;
  INSERT INTO admin_01b_results VALUES ('anon has no execute on any admin RPC', true, 'no execute');

  -- Audit table RLS stays enabled and forced ----------------------------------

  SELECT count(*) INTO v_count
  FROM pg_class AS c
  JOIN pg_namespace AS n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relname = 'admin_audit_events' AND c.relrowsecurity AND c.relforcerowsecurity;
  IF v_count <> 1 THEN RAISE EXCEPTION 'admin_audit_events does not keep enabled and forced RLS'; END IF;
  INSERT INTO admin_01b_results VALUES ('admin_audit_events keeps enabled and forced RLS', true, '1 table');

  -- Admin can read audit events; direct writes remain impossible -------------

  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT count(*) INTO v_count FROM public.admin_audit_events;
  EXECUTE 'RESET ROLE';
  IF v_count < 1 THEN RAISE EXCEPTION 'admin could not read any audit event'; END IF;
  INSERT INTO admin_01b_results VALUES ('admin can read audit events', true, format('%s rows', v_count));

  -- Regression: public catalog reads are unaffected ---------------------------

  EXECUTE 'SET LOCAL ROLE anon';
  SELECT count(*) INTO v_count FROM public.products WHERE category = 'TEST';
  EXECUTE 'RESET ROLE';
  IF v_count <> 0 THEN RAISE EXCEPTION 'anon can read a TEST-category product after ADMIN-01B'; END IF;
  INSERT INTO admin_01b_results VALUES ('TEST-category products stay hidden from anon after ADMIN-01B', true, '0 rows');
END
$$;

SELECT test_name, ok, detail
FROM admin_01b_results
ORDER BY test_name;

SELECT count(*) AS assertions, bool_and(ok) AS all_passed
FROM admin_01b_results;

ROLLBACK;
