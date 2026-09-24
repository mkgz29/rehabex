\set ON_ERROR_STOP on

BEGIN;

CREATE TEMP TABLE admin_01c_results (
  test_name text PRIMARY KEY,
  ok boolean NOT NULL,
  detail text
);

DO $$
DECLARE
  v_admin_id uuid := gen_random_uuid();
  v_other_admin_id uuid := gen_random_uuid();
  v_customer_id uuid := gen_random_uuid();
  v_authorized public.media_assets;
  v_finalized public.media_assets;
  v_second_finalize public.media_assets;
  v_product public.products;
  v_updated_product public.products;
  v_asset_2 public.media_assets;
  v_count integer;
  v_denied boolean;
  v_sqlstate text;
BEGIN
  INSERT INTO auth.users (id, aud, role, email, created_at, updated_at)
  VALUES
    (v_admin_id, 'authenticated', 'authenticated', 'admin-01c-admin@example.test', now(), now()),
    (v_other_admin_id, 'authenticated', 'authenticated', 'admin-01c-other-admin@example.test', now(), now()),
    (v_customer_id, 'authenticated', 'authenticated', 'admin-01c-customer@example.test', now(), now());

  UPDATE public.profiles SET role = 'admin' WHERE id IN (v_admin_id, v_other_admin_id);

  -- anon: no read, no write, no RPC execution -------------------------------

  IF has_function_privilege('anon', 'public.admin_create_pending_media_asset(text, text, uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.admin_finalize_media_asset(text, text, text, text, integer, integer, integer, uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'anon can execute a media RPC';
  END IF;
  INSERT INTO admin_01c_results VALUES ('anon has no execute on media RPCs', true, 'no execute');

  IF has_table_privilege('anon', 'public.media_assets', 'SELECT')
     OR has_table_privilege('anon', 'public.media_assets', 'INSERT')
     OR has_table_privilege('anon', 'public.media_assets', 'UPDATE')
     OR has_table_privilege('anon', 'public.media_assets', 'DELETE') THEN
    RAISE EXCEPTION 'anon retains a direct media_assets grant';
  END IF;
  INSERT INTO admin_01c_results VALUES ('anon has no direct media_assets grants at all', true, 'no grants');

  -- customer (authenticated, non-admin): read denied by RLS, RPC refused ----

  PERFORM set_config('request.jwt.claim.sub', v_customer_id::text, true);

  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT count(*) INTO v_count FROM public.media_assets;
  EXECUTE 'RESET ROLE';
  IF v_count <> 0 THEN RAISE EXCEPTION 'customer read media assets'; END IF;
  INSERT INTO admin_01c_results VALUES ('customer cannot read media assets', true, '0 rows');

  v_denied := false;
  EXECUTE 'SET LOCAL ROLE authenticated';
  BEGIN
    INSERT INTO public.media_assets (provider, public_id, folder, status, created_by)
    VALUES ('cloudinary', 'forbidden-direct-insert', 'rehabex/products', 'authorized', v_customer_id);
  EXCEPTION WHEN insufficient_privilege THEN
    v_denied := true;
  END;
  EXECUTE 'RESET ROLE';
  IF NOT v_denied THEN RAISE EXCEPTION 'customer inserted a media asset directly'; END IF;
  INSERT INTO admin_01c_results VALUES ('customer cannot insert media assets directly', true, 'denied');

  v_denied := false;
  EXECUTE 'SET LOCAL ROLE authenticated';
  BEGIN
    PERFORM public.admin_create_pending_media_asset('customer-public-id', 'rehabex/products', gen_random_uuid());
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE;
    v_denied := v_sqlstate = 'ADM03';
  END;
  EXECUTE 'RESET ROLE';
  IF NOT v_denied THEN RAISE EXCEPTION 'customer RPC call to authorize an upload was not refused'; END IF;
  INSERT INTO admin_01c_results VALUES ('customer cannot authorize an upload via RPC', true, 'ADM03');

  -- admin: cannot write media_assets directly, only through the RPCs -------

  PERFORM set_config('request.jwt.claim.sub', v_admin_id::text, true);

  v_denied := false;
  EXECUTE 'SET LOCAL ROLE authenticated';
  BEGIN
    INSERT INTO public.media_assets (provider, public_id, folder, status, created_by)
    VALUES ('cloudinary', 'forbidden-admin-direct-insert', 'rehabex/products', 'authorized', v_admin_id);
  EXCEPTION WHEN insufficient_privilege THEN
    v_denied := true;
  END;
  EXECUTE 'RESET ROLE';
  IF NOT v_denied THEN RAISE EXCEPTION 'admin inserted a media asset directly, bypassing the RPC boundary'; END IF;
  INSERT INTO admin_01c_results VALUES ('admin cannot insert media assets directly', true, 'denied');

  -- admin: authorize an upload, then finalize it ----------------------------

  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT * FROM public.admin_create_pending_media_asset('admin-01c-fixture-1', 'rehabex/products', gen_random_uuid()) INTO v_authorized;
  EXECUTE 'RESET ROLE';
  IF v_authorized.status <> 'authorized' THEN RAISE EXCEPTION 'a new authorization was not status=authorized'; END IF;
  INSERT INTO admin_01c_results VALUES ('admin authorizes an upload via RPC', true, 'status=authorized');

  -- Invalid dimensions are rejected and the row is left untouched -----------

  v_denied := false;
  EXECUTE 'SET LOCAL ROLE authenticated';
  BEGIN
    PERFORM public.admin_finalize_media_asset(v_authorized.public_id, 'https://res.cloudinary.com/demo/image/upload/v1/x.jpg', 'jpg', 'image/jpeg', 1000, 100, 100, gen_random_uuid());
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE;
    v_denied := v_sqlstate = 'ADM22';
  END;
  EXECUTE 'RESET ROLE';
  IF NOT v_denied THEN RAISE EXCEPTION 'undersized dimensions were accepted'; END IF;
  SELECT * INTO v_authorized FROM public.media_assets WHERE id = v_authorized.id;
  IF v_authorized.status <> 'authorized' THEN RAISE EXCEPTION 'a rejected finalize call mutated the row anyway'; END IF;
  INSERT INTO admin_01c_results VALUES ('undersized dimensions are rejected and the row stays untouched', true, 'ADM22');

  v_denied := false;
  EXECUTE 'SET LOCAL ROLE authenticated';
  BEGIN
    PERFORM public.admin_finalize_media_asset(v_authorized.public_id, 'https://res.cloudinary.com/demo/image/upload/v1/x.svg', 'svg', 'image/svg+xml', 1000, 800, 800, gen_random_uuid());
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE;
    v_denied := v_sqlstate = 'ADM22';
  END;
  EXECUTE 'RESET ROLE';
  IF NOT v_denied THEN RAISE EXCEPTION 'an SVG format was accepted'; END IF;
  INSERT INTO admin_01c_results VALUES ('a disallowed format (svg) is rejected', true, 'ADM22');

  v_denied := false;
  EXECUTE 'SET LOCAL ROLE authenticated';
  BEGIN
    PERFORM public.admin_finalize_media_asset(v_authorized.public_id, 'https://res.cloudinary.com/demo/image/upload/v1/x.jpg', 'jpg', 'image/jpeg', 9000000, 800, 800, gen_random_uuid());
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE;
    v_denied := v_sqlstate = 'ADM22';
  END;
  EXECUTE 'RESET ROLE';
  IF NOT v_denied THEN RAISE EXCEPTION 'an oversized byte count was accepted'; END IF;
  INSERT INTO admin_01c_results VALUES ('an oversized byte count is rejected', true, 'ADM22');

  -- Another admin's session cannot finalize someone else's authorization ----

  v_denied := false;
  PERFORM set_config('request.jwt.claim.sub', v_other_admin_id::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  BEGIN
    PERFORM public.admin_finalize_media_asset(v_authorized.public_id, 'https://res.cloudinary.com/demo/image/upload/v1/x.jpg', 'jpg', 'image/jpeg', 1000, 800, 800, gen_random_uuid());
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE;
    v_denied := v_sqlstate = 'ADM03';
  END;
  EXECUTE 'RESET ROLE';
  IF NOT v_denied THEN RAISE EXCEPTION 'a different admin session finalized someone elses authorization'; END IF;
  INSERT INTO admin_01c_results VALUES ('another session cannot finalize someone elses authorization', true, 'ADM03');

  -- An expired authorization is rejected -------------------------------------

  UPDATE public.media_assets SET created_at = now() - interval '10 minutes' WHERE id = v_authorized.id;
  v_denied := false;
  PERFORM set_config('request.jwt.claim.sub', v_admin_id::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  BEGIN
    PERFORM public.admin_finalize_media_asset(v_authorized.public_id, 'https://res.cloudinary.com/demo/image/upload/v1/x.jpg', 'jpg', 'image/jpeg', 1000, 800, 800, gen_random_uuid());
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE;
    v_denied := v_sqlstate = 'ADM10';
  END;
  EXECUTE 'RESET ROLE';
  IF NOT v_denied THEN RAISE EXCEPTION 'an expired authorization was accepted'; END IF;
  INSERT INTO admin_01c_results VALUES ('an authorization older than 5 minutes is rejected', true, 'ADM10');
  UPDATE public.media_assets SET created_at = now() WHERE id = v_authorized.id;

  -- A valid finalize succeeds, is audited, and is idempotent on retry -------

  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT * FROM public.admin_finalize_media_asset(v_authorized.public_id, 'https://res.cloudinary.com/demo/image/upload/v1700000000/admin-01c-fixture-1.jpg', 'jpg', 'image/jpeg', 250000, 1200, 900, gen_random_uuid()) INTO v_finalized;
  EXECUTE 'RESET ROLE';
  IF v_finalized.status <> 'pending' THEN RAISE EXCEPTION 'finalize did not move the asset to pending'; END IF;
  INSERT INTO admin_01c_results VALUES ('a valid finalize moves the asset to pending', true, 'status=pending');

  SELECT count(*) INTO v_count FROM public.admin_audit_events WHERE entity_id = v_finalized.id::text AND action = 'media.finalized';
  IF v_count <> 1 THEN RAISE EXCEPTION 'media.finalized audit event missing'; END IF;
  INSERT INTO admin_01c_results VALUES ('finalize is audited exactly once', true, '1 row');

  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT * FROM public.admin_finalize_media_asset(v_authorized.public_id, 'https://res.cloudinary.com/demo/image/upload/v1700000000/admin-01c-fixture-1.jpg', 'jpg', 'image/jpeg', 250000, 1200, 900, gen_random_uuid()) INTO v_second_finalize;
  EXECUTE 'RESET ROLE';
  IF v_second_finalize.id <> v_finalized.id OR v_second_finalize.status <> 'pending' THEN RAISE EXCEPTION 'idempotent retry did not return the same row'; END IF;
  SELECT count(*) INTO v_count FROM public.admin_audit_events WHERE entity_id = v_finalized.id::text AND action = 'media.finalized';
  IF v_count <> 1 THEN RAISE EXCEPTION 'an idempotent retry created a second audit event'; END IF;
  INSERT INTO admin_01c_results VALUES ('retrying the same finalize result is idempotent and audits nothing new', true, '1 row total');

  -- Attaching to a new product resolves the URL and marks the asset attached

  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT * FROM public.admin_create_product_with_media('ADMIN-01C fixture', '', 'Ortopedia', 100, NULL, v_finalized.id, false, 0, gen_random_uuid()) INTO v_product;
  EXECUTE 'RESET ROLE';
  IF v_product.image_url <> v_finalized.secure_url THEN RAISE EXCEPTION 'product did not receive the resolved secure_url'; END IF;
  IF v_product.image_asset_id <> v_finalized.id THEN RAISE EXCEPTION 'product.image_asset_id was not set'; END IF;
  INSERT INTO admin_01c_results VALUES ('creating a product with a media asset resolves the canonical URL', true, 'image_url=secure_url');

  SELECT status INTO v_finalized.status FROM public.media_assets WHERE id = v_finalized.id;
  IF v_finalized.status <> 'attached' THEN RAISE EXCEPTION 'asset was not marked attached'; END IF;
  INSERT INTO admin_01c_results VALUES ('attaching a pending asset marks it attached', true, 'status=attached');

  -- The client cannot decide the URL directly: a raw image_url alongside an
  -- asset id is rejected, and an already-attached asset cannot be reused.

  v_denied := false;
  EXECUTE 'SET LOCAL ROLE authenticated';
  BEGIN
    PERFORM public.admin_create_product_with_media('Ambiguous', '', 'Ortopedia', 100, 'https://attacker.invalid/x.jpg', v_finalized.id, false, 0, gen_random_uuid());
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE;
    v_denied := v_sqlstate = 'ADM22';
  END;
  EXECUTE 'RESET ROLE';
  IF NOT v_denied THEN RAISE EXCEPTION 'a request with both imageUrl and imageAssetId was accepted'; END IF;
  INSERT INTO admin_01c_results VALUES ('an imageUrl sent alongside an imageAssetId is rejected', true, 'ADM22');

  v_denied := false;
  EXECUTE 'SET LOCAL ROLE authenticated';
  BEGIN
    PERFORM public.admin_create_product_with_media('Reused asset', '', 'Ortopedia', 100, NULL, v_finalized.id, false, 0, gen_random_uuid());
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE;
    v_denied := v_sqlstate = 'ADM22';
  END;
  EXECUTE 'RESET ROLE';
  IF NOT v_denied THEN RAISE EXCEPTION 'an already-attached asset was reused for a second product'; END IF;
  SELECT count(*) INTO v_count FROM public.products WHERE name = 'Reused asset';
  IF v_count <> 0 THEN RAISE EXCEPTION 'a rejected creation still inserted a product'; END IF;
  INSERT INTO admin_01c_results VALUES ('an already-attached asset cannot be reused, and the rejected mutation created nothing', true, 'ADM22, 0 rows');

  -- Editing an unrelated field does not touch the existing image ------------

  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT * FROM public.admin_update_product_with_media(v_product.id, v_product.name, 'Updated description only', v_product.category, v_product.price, NULL, NULL, v_product.is_featured, v_product.display_order, v_product.updated_at, gen_random_uuid()) INTO v_updated_product;
  EXECUTE 'RESET ROLE';
  IF v_updated_product.image_url <> v_product.image_url OR v_updated_product.image_asset_id <> v_product.image_asset_id THEN
    RAISE EXCEPTION 'editing an unrelated field changed or cleared the existing image';
  END IF;
  INSERT INTO admin_01c_results VALUES ('editing an unrelated field leaves the existing image untouched', true, 'image unchanged');

  -- Replacing the image marks the old asset as an orphan candidate ----------

  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT * FROM public.admin_create_pending_media_asset('admin-01c-fixture-2', 'rehabex/products', gen_random_uuid()) INTO v_asset_2;
  SELECT * FROM public.admin_finalize_media_asset(v_asset_2.public_id, 'https://res.cloudinary.com/demo/image/upload/v1700000001/admin-01c-fixture-2.jpg', 'png', 'image/png', 300000, 1600, 1200, gen_random_uuid()) INTO v_asset_2;
  EXECUTE 'RESET ROLE';

  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT * FROM public.admin_update_product_with_media(v_updated_product.id, v_updated_product.name, v_updated_product.description, v_updated_product.category, v_updated_product.price, NULL, v_asset_2.id, v_updated_product.is_featured, v_updated_product.display_order, v_updated_product.updated_at, gen_random_uuid()) INTO v_updated_product;
  EXECUTE 'RESET ROLE';
  IF v_updated_product.image_asset_id <> v_asset_2.id THEN RAISE EXCEPTION 'the product does not reference the replacement asset'; END IF;
  INSERT INTO admin_01c_results VALUES ('replacing the image attaches the new asset', true, 'image_asset_id updated');

  SELECT status INTO v_finalized.status FROM public.media_assets WHERE id = v_finalized.id;
  IF v_finalized.status <> 'orphan_candidate' THEN RAISE EXCEPTION 'the replaced asset was not marked orphan_candidate'; END IF;
  INSERT INTO admin_01c_results VALUES ('the replaced asset becomes an orphan_candidate', true, 'status=orphan_candidate');

  SELECT count(*) INTO v_count FROM public.admin_audit_events WHERE entity_id = v_finalized.id::text AND action = 'media.orphaned';
  IF v_count <> 1 THEN RAISE EXCEPTION 'media.orphaned audit event missing'; END IF;
  INSERT INTO admin_01c_results VALUES ('the orphan transition is audited exactly once', true, '1 row');

  -- No physical deletion exists for any client role -------------------------

  IF has_table_privilege('authenticated', 'public.media_assets', 'DELETE')
     OR has_table_privilege('anon', 'public.media_assets', 'DELETE') THEN
    RAISE EXCEPTION 'a client role retains DELETE on media_assets';
  END IF;
  INSERT INTO admin_01c_results VALUES ('no client role can delete media_assets rows', true, 'no grant');

  -- RLS stays enabled and forced ----------------------------------------------

  SELECT count(*) INTO v_count
  FROM pg_class AS c
  JOIN pg_namespace AS n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relname = 'media_assets' AND c.relrowsecurity AND c.relforcerowsecurity;
  IF v_count <> 1 THEN RAISE EXCEPTION 'media_assets does not keep enabled and forced RLS'; END IF;
  INSERT INTO admin_01c_results VALUES ('media_assets keeps enabled and forced RLS', true, '1 table');

  -- Regression: public catalog reads are unaffected --------------------------

  EXECUTE 'SET LOCAL ROLE anon';
  SELECT count(*) INTO v_count FROM public.products WHERE id = v_product.id AND is_active = true;
  EXECUTE 'RESET ROLE';
  IF v_count <> 0 THEN RAISE EXCEPTION 'an inactive fixture became publicly visible'; END IF;
  INSERT INTO admin_01c_results VALUES ('inactive fixtures stay hidden from anon after ADMIN-01C', true, '0 rows');
END
$$;

SELECT test_name, ok, detail
FROM admin_01c_results
ORDER BY test_name;

SELECT count(*) AS assertions, bool_and(ok) AS all_passed
FROM admin_01c_results;

ROLLBACK;
