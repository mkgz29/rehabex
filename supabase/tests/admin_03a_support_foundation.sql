\set ON_ERROR_STOP on

BEGIN;

CREATE TEMP TABLE admin_03a_results (
  test_name text PRIMARY KEY,
  ok boolean NOT NULL,
  detail text
);

DO $$
DECLARE
  v_customer_id uuid := gen_random_uuid();
  v_admin_id uuid := gen_random_uuid();
  v_order_id uuid;
  v_request public.support_requests;
  v_updated public.support_requests;
  v_optional public.support_requests;
  v_count integer;
  v_denied boolean;
  v_sqlstate text;
  v_stale_updated_at timestamptz;
BEGIN
  INSERT INTO auth.users (id, aud, role, email, created_at, updated_at)
  VALUES
    (v_customer_id, 'authenticated', 'authenticated', 'admin-03a-customer@example.test', now(), now()),
    (v_admin_id, 'authenticated', 'authenticated', 'admin-03a-admin@example.test', now(), now());

  UPDATE public.profiles SET role = 'admin' WHERE id = v_admin_id;

  -- orders still carries its original (pre-FASE-1B) required columns
  -- (status/amount/items) alongside the newer order_status/payment_status
  -- pair added by 202609110103; both must be satisfied here.
  INSERT INTO public.orders (id, status, amount, items, currency, customer_email, order_status, payment_status)
  VALUES (gen_random_uuid(), 'approved', 100, '[]'::jsonb, 'ARS', 'order-owner@example.test', 'confirmed', 'approved')
  RETURNING id INTO v_order_id;

  -- anon: no execute grant, no direct table grants, no read -----------------

  IF has_function_privilege('anon', 'public.admin_create_support_request(text, text, text, text, text, uuid, uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'anon can execute admin_create_support_request';
  END IF;
  INSERT INTO admin_03a_results VALUES ('anon has no execute on admin_create_support_request', true, 'no execute');

  IF has_table_privilege('anon', 'public.support_requests', 'SELECT')
     OR has_table_privilege('anon', 'public.support_requests', 'INSERT')
     OR has_table_privilege('anon', 'public.support_requests', 'UPDATE')
     OR has_table_privilege('anon', 'public.support_requests', 'DELETE') THEN
    RAISE EXCEPTION 'anon retains a direct grant on support_requests';
  END IF;
  INSERT INTO admin_03a_results VALUES ('anon has no direct grants on support_requests', true, 'no grants');

  v_denied := false;
  EXECUTE 'SET LOCAL ROLE anon';
  BEGIN
    SELECT count(*) INTO v_count FROM public.support_requests;
  EXCEPTION WHEN insufficient_privilege THEN
    v_denied := true;
  END;
  EXECUTE 'RESET ROLE';
  IF NOT v_denied THEN RAISE EXCEPTION 'anon read support_requests'; END IF;
  INSERT INTO admin_03a_results VALUES ('anon cannot read support_requests', true, 'denied');

  -- authenticated non-admin: RPC executes but is refused internally --------

  PERFORM set_config('request.jwt.claim.sub', v_customer_id::text, true);

  v_denied := false;
  EXECUTE 'SET LOCAL ROLE authenticated';
  BEGIN
    PERFORM public.admin_create_support_request('Forbidden customer', 'forbidden@example.test', NULL, 'Asunto', 'Mensaje', NULL, gen_random_uuid());
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE;
    v_denied := v_sqlstate = 'ADM03';
  END;
  EXECUTE 'RESET ROLE';
  IF NOT v_denied THEN RAISE EXCEPTION 'customer was not refused by admin_create_support_request'; END IF;
  INSERT INTO admin_03a_results VALUES ('customer RPC create is refused with forbidden', true, 'ADM03');

  v_denied := false;
  EXECUTE 'SET LOCAL ROLE authenticated';
  BEGIN
    PERFORM public.admin_list_support_requests(NULL);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE;
    v_denied := v_sqlstate = 'ADM03';
  END;
  EXECUTE 'RESET ROLE';
  IF NOT v_denied THEN RAISE EXCEPTION 'customer was not refused by admin_list_support_requests'; END IF;
  INSERT INTO admin_03a_results VALUES ('customer RPC list is refused with forbidden', true, 'ADM03');

  v_denied := false;
  EXECUTE 'SET LOCAL ROLE authenticated';
  BEGIN
    INSERT INTO public.support_requests (customer_name, customer_email, subject, message, created_by)
    VALUES ('Direct insert', 'direct@example.test', 'Asunto', 'Mensaje', v_customer_id);
  EXCEPTION WHEN insufficient_privilege THEN
    v_denied := true;
  END;
  EXECUTE 'RESET ROLE';
  IF NOT v_denied THEN RAISE EXCEPTION 'customer inserted a support request directly'; END IF;
  INSERT INTO admin_03a_results VALUES ('customer cannot insert support_requests directly', true, 'denied');

  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT count(*) INTO v_count FROM public.support_requests;
  EXECUTE 'RESET ROLE';
  IF v_count <> 0 THEN RAISE EXCEPTION 'customer read support_requests'; END IF;
  INSERT INTO admin_03a_results VALUES ('customer cannot read support_requests', true, '0 rows');

  -- admin: direct DML is impossible, only the RPCs remain -------------------

  PERFORM set_config('request.jwt.claim.sub', v_admin_id::text, true);

  v_denied := false;
  EXECUTE 'SET LOCAL ROLE authenticated';
  BEGIN
    INSERT INTO public.support_requests (customer_name, customer_email, subject, message, created_by)
    VALUES ('Admin direct insert', 'direct@example.test', 'Asunto', 'Mensaje', v_admin_id);
  EXCEPTION WHEN insufficient_privilege THEN
    v_denied := true;
  END;
  EXECUTE 'RESET ROLE';
  IF NOT v_denied THEN RAISE EXCEPTION 'admin inserted a support request directly, bypassing the RPC boundary'; END IF;
  INSERT INTO admin_03a_results VALUES ('admin cannot insert support_requests directly', true, 'denied');

  -- admin: create is validated and audited exactly once ----------------------

  v_denied := false;
  BEGIN
    PERFORM public.admin_create_support_request('', 'cliente@example.test', NULL, 'Asunto', 'Mensaje', NULL, gen_random_uuid());
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE;
    v_denied := v_sqlstate = 'ADM22';
  END;
  IF NOT v_denied THEN RAISE EXCEPTION 'an empty customer_name was accepted'; END IF;
  INSERT INTO admin_03a_results VALUES ('an empty customer_name is rejected', true, 'ADM22');

  v_denied := false;
  BEGIN
    PERFORM public.admin_create_support_request('Cliente', 'not-an-email', NULL, 'Asunto', 'Mensaje', NULL, gen_random_uuid());
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE;
    v_denied := v_sqlstate = 'ADM22';
  END;
  IF NOT v_denied THEN RAISE EXCEPTION 'a malformed email was accepted'; END IF;
  INSERT INTO admin_03a_results VALUES ('a malformed customer_email is rejected', true, 'ADM22');

  v_denied := false;
  BEGIN
    PERFORM public.admin_create_support_request('Cliente', 'cliente@example.test', NULL, 'Asunto', 'Mensaje', gen_random_uuid(), gen_random_uuid());
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE;
    v_denied := v_sqlstate = 'ADM04';
  END;
  IF NOT v_denied THEN RAISE EXCEPTION 'a nonexistent order_id was accepted'; END IF;
  INSERT INTO admin_03a_results VALUES ('a nonexistent order_id is rejected with not_found', true, 'ADM04');

  -- subject is optional end-to-end: absent, empty, and whitespace-only all
  -- normalize to NULL (not rejected); only an actually oversized subject is.

  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT * FROM public.admin_create_support_request('Cliente Sin Asunto', 'sinasunto@example.test', NULL, NULL, 'Mensaje sin asunto.', NULL, gen_random_uuid()) INTO v_optional;
  EXECUTE 'RESET ROLE';
  IF v_optional.subject IS NOT NULL THEN RAISE EXCEPTION 'a NULL subject was not stored as NULL'; END IF;
  INSERT INTO admin_03a_results VALUES ('a NULL subject is accepted and stored as NULL', true, 'subject=NULL');

  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT * FROM public.admin_create_support_request('Cliente Asunto Vacio', 'vacio@example.test', NULL, '   ', 'Mensaje con asunto en blanco.', NULL, gen_random_uuid()) INTO v_optional;
  EXECUTE 'RESET ROLE';
  IF v_optional.subject IS NOT NULL THEN RAISE EXCEPTION 'a whitespace-only subject was not normalized to NULL'; END IF;
  INSERT INTO admin_03a_results VALUES ('a whitespace-only subject normalizes to NULL', true, 'subject=NULL');

  v_denied := false;
  BEGIN
    PERFORM public.admin_create_support_request('Cliente', 'cliente@example.test', NULL, repeat('x', 201), 'Mensaje', NULL, gen_random_uuid());
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE;
    v_denied := v_sqlstate = 'ADM22';
  END;
  IF NOT v_denied THEN RAISE EXCEPTION 'an oversized subject was accepted'; END IF;
  INSERT INTO admin_03a_results VALUES ('an oversized subject is rejected', true, 'ADM22');

  -- The two optional-subject fixtures above are scratch rows for that check
  -- only; remove them (as table owner, bypassing RLS) so the list/count
  -- assertions below see exactly the one ticket they expect.
  DELETE FROM public.support_requests WHERE customer_email IN ('sinasunto@example.test', 'vacio@example.test');

  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT * FROM public.admin_create_support_request('Cliente Real', 'cliente@example.test', '+54 9 11 1234-5678', 'No llego mi pedido', 'Hola, todavia no me llego el pedido.', v_order_id, gen_random_uuid()) INTO v_request;
  EXECUTE 'RESET ROLE';
  IF v_request.status <> 'open' THEN RAISE EXCEPTION 'created support request is not open by default'; END IF;
  INSERT INTO admin_03a_results VALUES ('admin creates an open support request via RPC', true, 'status=open');

  SELECT count(*) INTO v_count FROM public.admin_audit_events WHERE entity_id = v_request.id::text AND action = 'support_request.created';
  IF v_count <> 1 THEN RAISE EXCEPTION 'support_request.created audit event missing'; END IF;
  INSERT INTO admin_03a_results VALUES ('support request creation is audited exactly once', true, '1 row');

  -- admin: list and get ------------------------------------------------------

  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT count(*) INTO v_count FROM public.admin_list_support_requests(NULL);
  EXECUTE 'RESET ROLE';
  IF v_count <> 1 THEN RAISE EXCEPTION 'admin_list_support_requests did not return the created row'; END IF;
  INSERT INTO admin_03a_results VALUES ('admin lists support requests via RPC', true, '1 row');

  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT count(*) INTO v_count FROM public.admin_list_support_requests('resolved');
  EXECUTE 'RESET ROLE';
  IF v_count <> 0 THEN RAISE EXCEPTION 'admin_list_support_requests ignored the status filter'; END IF;
  INSERT INTO admin_03a_results VALUES ('admin_list_support_requests filters by status', true, '0 rows');

  v_denied := false;
  BEGIN
    PERFORM public.admin_list_support_requests('bogus');
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE;
    v_denied := v_sqlstate = 'ADM22';
  END;
  IF NOT v_denied THEN RAISE EXCEPTION 'an invalid status filter was accepted'; END IF;
  INSERT INTO admin_03a_results VALUES ('admin_list_support_requests rejects an invalid status filter', true, 'ADM22');

  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT * FROM public.admin_get_support_request(v_request.id) INTO v_request;
  EXECUTE 'RESET ROLE';
  IF v_request.customer_name <> 'Cliente Real' THEN RAISE EXCEPTION 'admin_get_support_request returned the wrong row'; END IF;
  INSERT INTO admin_03a_results VALUES ('admin reads a single support request via RPC', true, 'customer_name matches');

  v_denied := false;
  BEGIN
    PERFORM public.admin_get_support_request(gen_random_uuid());
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE;
    v_denied := v_sqlstate = 'ADM04';
  END;
  IF NOT v_denied THEN RAISE EXCEPTION 'an unknown support request id did not raise not_found'; END IF;
  INSERT INTO admin_03a_results VALUES ('admin_get_support_request raises not_found for an unknown id', true, 'ADM04');

  -- admin: status transitions, concurrency and audit -------------------------

  v_stale_updated_at := v_request.updated_at;
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT * FROM public.admin_update_support_request_status(v_request.id, 'answered', v_request.updated_at, gen_random_uuid()) INTO v_updated;
  EXECUTE 'RESET ROLE';
  IF v_updated.status <> 'answered' THEN RAISE EXCEPTION 'status change to answered did not take effect'; END IF;
  INSERT INTO admin_03a_results VALUES ('admin changes status to answered via RPC', true, 'status=answered');

  SELECT count(*) INTO v_count FROM public.admin_audit_events WHERE entity_id = v_updated.id::text AND action = 'support_request.status_changed';
  IF v_count <> 1 THEN RAISE EXCEPTION 'support_request.status_changed audit event missing'; END IF;
  INSERT INTO admin_03a_results VALUES ('status change is audited exactly once', true, '1 row');

  v_denied := false;
  BEGIN
    PERFORM public.admin_update_support_request_status(v_updated.id, 'closed-invalid', v_updated.updated_at, gen_random_uuid());
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE;
    v_denied := v_sqlstate = 'ADM22';
  END;
  IF NOT v_denied THEN RAISE EXCEPTION 'an invalid status value was accepted'; END IF;
  INSERT INTO admin_03a_results VALUES ('an invalid status value is rejected', true, 'ADM22');

  -- Stale version is rejected (now() is transaction-frozen here; see the
  -- identical note in admin_01b_admin_boundary.sql for why this still
  -- exercises the real comparison a genuinely stale client would trigger).
  v_denied := false;
  EXECUTE 'SET LOCAL ROLE authenticated';
  BEGIN
    PERFORM public.admin_update_support_request_status(v_updated.id, 'resolved', v_updated.updated_at - interval '1 second', gen_random_uuid());
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE;
    v_denied := v_sqlstate = 'ADM09';
  END;
  EXECUTE 'RESET ROLE';
  IF NOT v_denied THEN RAISE EXCEPTION 'a stale version was accepted instead of rejected with a conflict'; END IF;
  INSERT INTO admin_03a_results VALUES ('stale expected_updated_at on status change is rejected', true, 'ADM09');

  SELECT count(*) INTO v_count FROM public.support_requests WHERE id = v_updated.id AND status = 'resolved';
  IF v_count <> 0 THEN RAISE EXCEPTION 'the rejected concurrent status change applied anyway'; END IF;
  INSERT INTO admin_03a_results VALUES ('a rejected concurrent status change changes nothing', true, '0 rows');

  -- Same-status update is a no-op: no audit event, updated_at untouched -----

  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT * FROM public.admin_update_support_request_status(v_updated.id, v_updated.status, v_updated.updated_at, gen_random_uuid()) INTO v_updated;
  EXECUTE 'RESET ROLE';
  SELECT count(*) INTO v_count FROM public.admin_audit_events WHERE entity_id = v_updated.id::text AND action = 'support_request.status_changed';
  IF v_count <> 1 THEN RAISE EXCEPTION 'a same-status update produced a misleading audit event'; END IF;
  INSERT INTO admin_03a_results VALUES ('a same-status update is a no-op (still exactly 1 audit row)', true, '1 row');

  -- admin: internal notes -----------------------------------------------------

  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT * FROM public.admin_update_support_request_notes(v_updated.id, 'Llamar mañana para confirmar envio.', v_updated.updated_at, gen_random_uuid()) INTO v_updated;
  EXECUTE 'RESET ROLE';
  IF v_updated.internal_notes IS DISTINCT FROM 'Llamar mañana para confirmar envio.' THEN RAISE EXCEPTION 'internal_notes update did not apply'; END IF;
  INSERT INTO admin_03a_results VALUES ('admin sets internal notes via RPC', true, 'notes set');

  SELECT count(*) INTO v_count FROM public.admin_audit_events WHERE entity_id = v_updated.id::text AND action = 'support_request.notes_updated';
  IF v_count <> 1 THEN RAISE EXCEPTION 'support_request.notes_updated audit event missing'; END IF;
  INSERT INTO admin_03a_results VALUES ('notes update is audited exactly once', true, '1 row');

  -- Unknown support request id: not_found ------------------------------------

  v_denied := false;
  EXECUTE 'SET LOCAL ROLE authenticated';
  BEGIN
    PERFORM public.admin_update_support_request_status(gen_random_uuid(), 'resolved', now(), gen_random_uuid());
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE;
    v_denied := v_sqlstate = 'ADM04';
  END;
  EXECUTE 'RESET ROLE';
  IF NOT v_denied THEN RAISE EXCEPTION 'updating an unknown support request did not raise not_found'; END IF;
  INSERT INTO admin_03a_results VALUES ('updating an unknown support request raises not_found', true, 'ADM04');

  -- order_id is nulled, not blocked, if the referenced order is deleted -----

  DELETE FROM public.orders WHERE id = v_order_id;
  SELECT count(*) INTO v_count FROM public.support_requests WHERE id = v_updated.id AND order_id IS NULL;
  IF v_count <> 1 THEN RAISE EXCEPTION 'deleting the referenced order did not null out support_requests.order_id'; END IF;
  INSERT INTO admin_03a_results VALUES ('deleting the linked order nulls support_requests.order_id (ON DELETE SET NULL)', true, '1 row');

  -- Function grants: anon has no execute on any support RPC ------------------

  IF has_function_privilege('anon', 'public.admin_update_support_request_status(uuid, text, timestamptz, uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.admin_update_support_request_notes(uuid, text, timestamptz, uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.admin_get_support_request(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'anon can execute a support RPC';
  END IF;
  INSERT INTO admin_03a_results VALUES ('anon has no execute on any support RPC', true, 'no execute');

  -- Table RLS stays enabled and forced ----------------------------------------

  SELECT count(*) INTO v_count
  FROM pg_class AS c
  JOIN pg_namespace AS n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relname = 'support_requests' AND c.relrowsecurity AND c.relforcerowsecurity;
  IF v_count <> 1 THEN RAISE EXCEPTION 'support_requests does not keep enabled and forced RLS'; END IF;
  INSERT INTO admin_03a_results VALUES ('support_requests keeps enabled and forced RLS', true, '1 table');

  -- Admin can read support_requests directly via RLS (defense in depth) -----

  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT count(*) INTO v_count FROM public.support_requests;
  EXECUTE 'RESET ROLE';
  IF v_count < 1 THEN RAISE EXCEPTION 'admin could not read any support request directly'; END IF;
  INSERT INTO admin_03a_results VALUES ('admin can read support_requests directly (RLS, defense in depth)', true, format('%s rows', v_count));
END
$$;

SELECT test_name, ok, detail
FROM admin_03a_results
ORDER BY test_name;

SELECT count(*) AS assertions, bool_and(ok) AS all_passed
FROM admin_03a_results;

ROLLBACK;
