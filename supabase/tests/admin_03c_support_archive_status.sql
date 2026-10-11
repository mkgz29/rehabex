\set ON_ERROR_STOP on

BEGIN;

CREATE TEMP TABLE admin_03c_results (
  test_name text PRIMARY KEY,
  ok boolean NOT NULL,
  detail text
);

DO $$
DECLARE
  v_admin_id uuid := gen_random_uuid();
  v_request public.support_requests;
  v_updated public.support_requests;
  v_count integer;
  v_denied boolean;
  v_sqlstate text;
BEGIN
  INSERT INTO auth.users (id, aud, role, email, created_at, updated_at)
  VALUES (v_admin_id, 'authenticated', 'authenticated', 'admin-03c-admin@example.test', now(), now());
  UPDATE public.profiles SET role = 'admin' WHERE id = v_admin_id;

  PERFORM set_config('request.jwt.claim.sub', v_admin_id::text, true);

  -- CHECK constraint directly permits 'archived' and still rejects garbage --

  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT * FROM public.admin_create_support_request('Cliente Archivo', 'archivo@example.test', NULL, 'Asunto', 'Mensaje de prueba 03c.', NULL, gen_random_uuid()) INTO v_request;
  EXECUTE 'RESET ROLE';
  IF v_request.status <> 'open' THEN RAISE EXCEPTION 'created support request is not open by default'; END IF;
  INSERT INTO admin_03c_results VALUES ('a newly created ticket is still open by default (unchanged)', true, 'status=open');

  v_denied := false;
  BEGIN
    -- As table owner (bypassing the RPC boundary on purpose, just to probe
    -- the raw CHECK constraint itself): a genuinely invalid status is still
    -- rejected at the DB level, not just by the RPC's own IN-list check.
    UPDATE public.support_requests SET status = 'closed-invalid' WHERE id = v_request.id;
  EXCEPTION WHEN check_violation THEN
    v_denied := true;
  END;
  IF NOT v_denied THEN RAISE EXCEPTION 'the status CHECK constraint accepted an invalid value'; END IF;
  INSERT INTO admin_03c_results VALUES ('the status CHECK constraint still rejects an invalid value', true, 'check_violation');

  UPDATE public.support_requests SET status = 'archived' WHERE id = v_request.id;
  SELECT count(*) INTO v_count FROM public.support_requests WHERE id = v_request.id AND status = 'archived';
  IF v_count <> 1 THEN RAISE EXCEPTION 'the status CHECK constraint rejected ''archived'''; END IF;
  INSERT INTO admin_03c_results VALUES ('the status CHECK constraint accepts ''archived''', true, '1 row');

  -- Revert the direct UPDATE above (that was only to probe the raw
  -- constraint) so the RPC-driven assertions below start from a known state.
  UPDATE public.support_requests SET status = 'open' WHERE id = v_request.id;
  SELECT * INTO v_request FROM public.support_requests WHERE id = v_request.id;

  -- admin_update_support_request_status: open -> archived -> open via RPC --

  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT * FROM public.admin_update_support_request_status(v_request.id, 'archived', v_request.updated_at, gen_random_uuid()) INTO v_updated;
  EXECUTE 'RESET ROLE';
  IF v_updated.status <> 'archived' THEN RAISE EXCEPTION 'archiving via the RPC did not take effect'; END IF;
  INSERT INTO admin_03c_results VALUES ('admin archives a ticket via admin_update_support_request_status', true, 'status=archived');

  SELECT count(*) INTO v_count FROM public.admin_audit_events WHERE entity_id = v_updated.id::text AND action = 'support_request.status_changed' AND after_state ->> 'status' = 'archived';
  IF v_count <> 1 THEN RAISE EXCEPTION 'archiving was not audited'; END IF;
  INSERT INTO admin_03c_results VALUES ('archiving a ticket is audited exactly once', true, '1 row');

  -- Archiving never deletes anything: message/phone/notes survive ----------

  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT * FROM public.admin_update_support_request_notes(v_updated.id, 'Nota conservada tras archivar.', v_updated.updated_at, gen_random_uuid()) INTO v_updated;
  EXECUTE 'RESET ROLE';

  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT * FROM public.admin_update_support_request_status(v_updated.id, 'open', v_updated.updated_at, gen_random_uuid()) INTO v_updated;
  EXECUTE 'RESET ROLE';
  IF v_updated.status <> 'open' THEN RAISE EXCEPTION 'reopening an archived ticket did not take effect'; END IF;
  IF v_updated.customer_name <> 'Cliente Archivo' THEN RAISE EXCEPTION 'customer_name was lost across archive/reopen'; END IF;
  IF v_updated.message <> 'Mensaje de prueba 03c.' THEN RAISE EXCEPTION 'message was lost across archive/reopen'; END IF;
  IF v_updated.internal_notes IS DISTINCT FROM 'Nota conservada tras archivar.' THEN RAISE EXCEPTION 'internal_notes was lost across archive/reopen'; END IF;
  INSERT INTO admin_03c_results VALUES ('a ticket is reopened to open, with message/customer_name/notes all preserved (never deleted)', true, 'status=open, data intact');

  -- admin_list_support_requests: 'archived' is a valid, filterable status --

  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT * FROM public.admin_update_support_request_status(v_updated.id, 'archived', v_updated.updated_at, gen_random_uuid()) INTO v_updated;
  EXECUTE 'RESET ROLE';

  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT count(*) INTO v_count FROM public.admin_list_support_requests('archived');
  EXECUTE 'RESET ROLE';
  IF v_count <> 1 THEN RAISE EXCEPTION 'admin_list_support_requests(''archived'') did not return the archived ticket'; END IF;
  INSERT INTO admin_03c_results VALUES ('admin_list_support_requests(''archived'') returns the archived ticket', true, '1 row');

  -- NULL (no filter) still returns every status, including archived -- the
  -- "Todas excludes archived" rule is enforced client-side, not by this RPC.
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT count(*) INTO v_count FROM public.admin_list_support_requests(NULL);
  EXECUTE 'RESET ROLE';
  IF v_count <> 1 THEN RAISE EXCEPTION 'admin_list_support_requests(NULL) did not include the archived ticket'; END IF;
  INSERT INTO admin_03c_results VALUES ('admin_list_support_requests(NULL) still includes archived tickets (unfiltered)', true, '1 row');

  -- Both RPCs still reject a genuinely invalid status value ------------------

  v_denied := false;
  BEGIN
    PERFORM public.admin_list_support_requests('bogus');
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE;
    v_denied := v_sqlstate = 'ADM22';
  END;
  IF NOT v_denied THEN RAISE EXCEPTION 'admin_list_support_requests accepted an invalid status filter'; END IF;
  INSERT INTO admin_03c_results VALUES ('admin_list_support_requests still rejects an invalid status filter', true, 'ADM22');

  v_denied := false;
  BEGIN
    PERFORM public.admin_update_support_request_status(v_updated.id, 'bogus', v_updated.updated_at, gen_random_uuid());
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE;
    v_denied := v_sqlstate = 'ADM22';
  END;
  IF NOT v_denied THEN RAISE EXCEPTION 'admin_update_support_request_status accepted an invalid status value'; END IF;
  INSERT INTO admin_03c_results VALUES ('admin_update_support_request_status still rejects an invalid status value', true, 'ADM22');

  -- Grants/RLS are unaffected: both functions kept their exact signatures --

  IF has_function_privilege('anon', 'public.admin_update_support_request_status(uuid, text, timestamptz, uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.admin_list_support_requests(text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'anon can execute a support status RPC after 03c';
  END IF;
  INSERT INTO admin_03c_results VALUES ('anon still has no execute on either RPC after 03c', true, 'no execute');

  SELECT count(*) INTO v_count
  FROM pg_class AS c
  JOIN pg_namespace AS n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relname = 'support_requests' AND c.relrowsecurity AND c.relforcerowsecurity;
  IF v_count <> 1 THEN RAISE EXCEPTION 'support_requests lost enabled/forced RLS after 03c'; END IF;
  INSERT INTO admin_03c_results VALUES ('support_requests keeps enabled and forced RLS after 03c', true, '1 table');
END
$$;

SELECT test_name, ok, detail
FROM admin_03c_results
ORDER BY test_name;

SELECT count(*) AS assertions, bool_and(ok) AS all_passed
FROM admin_03c_results;

ROLLBACK;
