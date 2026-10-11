\set ON_ERROR_STOP on

BEGIN;

CREATE TEMP TABLE admin_03b_results (
  test_name text PRIMARY KEY,
  ok boolean NOT NULL,
  detail text
);

DO $$
DECLARE
  v_admin_id uuid := gen_random_uuid();
  v_row public.support_requests;
  v_admin_row public.support_requests;
  v_count integer;
  v_denied boolean;
  v_sqlstate text;
  v_hash text;
  v_topic text;
  v_rpc_name text;
  v_allowed_topics text[] := ARRAY['product', 'order', 'shipping', 'payment', 'returns_warranty', 'advice', 'general', 'other'];
BEGIN
  INSERT INTO auth.users (id, aud, role, email, created_at, updated_at)
  VALUES (v_admin_id, 'authenticated', 'authenticated', 'admin-03b-admin@example.test', now(), now());
  UPDATE public.profiles SET role = 'admin' WHERE id = v_admin_id;

  -- grants: only service_role may call the public intake RPC. The browser's
  -- anon key must never reach it directly -- the approved path is
  -- Browser -> POST /api/support-intake -> Vercel serverless (service_role)
  -- -> public_create_support_request. --------------------------------------

  IF has_function_privilege('anon', 'public.public_create_support_request(text, text, text, text, text, text, text, uuid, text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'anon can execute public_create_support_request -- the browser must not reach this RPC directly';
  END IF;
  INSERT INTO admin_03b_results VALUES ('anon has no execute on public_create_support_request', true, 'no execute');

  IF has_function_privilege('authenticated', 'public.public_create_support_request(text, text, text, text, text, text, text, uuid, text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'authenticated can execute public_create_support_request';
  END IF;
  INSERT INTO admin_03b_results VALUES ('authenticated has no execute on public_create_support_request', true, 'no execute');

  IF NOT has_function_privilege('service_role', 'public.public_create_support_request(text, text, text, text, text, text, text, uuid, text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'service_role cannot execute public_create_support_request';
  END IF;
  INSERT INTO admin_03b_results VALUES ('service_role can execute public_create_support_request', true, 'execute granted');

  IF has_function_privilege('anon', 'public.consume_support_intake_rate_limit(text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'anon can execute the rate-limit RPC directly';
  END IF;
  INSERT INTO admin_03b_results VALUES ('anon has no direct execute on consume_support_intake_rate_limit', true, 'no execute');

  IF has_function_privilege('authenticated', 'public.consume_support_intake_rate_limit(text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'authenticated can execute the rate-limit RPC directly';
  END IF;
  INSERT INTO admin_03b_results VALUES ('authenticated has no direct execute on consume_support_intake_rate_limit', true, 'no execute');

  IF NOT has_function_privilege('service_role', 'public.consume_support_intake_rate_limit(text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'service_role cannot execute the rate-limit RPC';
  END IF;
  INSERT INTO admin_03b_results VALUES ('service_role can execute consume_support_intake_rate_limit', true, 'execute granted');

  IF has_table_privilege('anon', 'public.support_intake_rate_limit_windows', 'SELECT')
     OR has_table_privilege('anon', 'public.support_intake_rate_limit_windows', 'INSERT') THEN
    RAISE EXCEPTION 'anon retains a direct grant on support_intake_rate_limit_windows';
  END IF;
  INSERT INTO admin_03b_results VALUES ('anon has no direct grants on support_intake_rate_limit_windows', true, 'no grants');

  -- NOTE: an actual SET ROLE anon/authenticated + direct call attempt against
  -- public_create_support_request was tried here and reproducibly crashed
  -- this local Postgres instance (confirmed not caused by this migration:
  -- the identical crash reproduces calling the pre-existing, already-deployed
  -- admin_create_support_request the same way, and persists across a full
  -- baseline+migrations rebuild from zero). has_function_privilege() above
  -- is the same mechanism Postgres's own ACL enforcement consults internally
  -- and is what 03A's own test already relies on for every "no execute"
  -- assertion except the one case (authenticated-but-not-admin) where the
  -- role genuinely has EXECUTE and only the RPC's internal is_admin() check
  -- refuses it -- this local environment never exercised a true zero-grant
  -- call attempt before now. Documented here rather than silently dropped.

  -- regression guard: 03A's anon boundary on support_requests still holds ---

  IF has_table_privilege('anon', 'public.support_requests', 'SELECT')
     OR has_table_privilege('anon', 'public.support_requests', 'INSERT')
     OR has_table_privilege('anon', 'public.support_requests', 'UPDATE')
     OR has_table_privilege('anon', 'public.support_requests', 'DELETE') THEN
    RAISE EXCEPTION 'anon gained a direct grant on support_requests via 03B';
  END IF;
  INSERT INTO admin_03b_results VALUES ('anon still has no direct grants on support_requests', true, 'no grants');

  v_denied := false;
  EXECUTE 'SET LOCAL ROLE anon';
  BEGIN
    SELECT count(*) INTO v_count FROM public.support_requests;
  EXCEPTION WHEN insufficient_privilege THEN
    v_denied := true;
  END;
  EXECUTE 'RESET ROLE';
  IF NOT v_denied THEN RAISE EXCEPTION 'anon can read support_requests after 03B'; END IF;
  INSERT INTO admin_03b_results VALUES ('anon still cannot read support_requests', true, 'denied');

  FOR v_rpc_name IN SELECT unnest(ARRAY[
    'public.admin_list_support_requests(text)',
    'public.admin_get_support_request(uuid)',
    'public.admin_update_support_request_status(uuid, text, timestamptz, uuid)',
    'public.admin_update_support_request_notes(uuid, text, timestamptz, uuid)'
  ])
  LOOP
    IF has_function_privilege('anon', v_rpc_name, 'EXECUTE') THEN
      RAISE EXCEPTION 'anon can execute % after 03B', v_rpc_name;
    END IF;
  END LOOP;
  INSERT INTO admin_03b_results VALUES ('anon still has no execute on any admin Soporte RPC', true, 'no execute');

  -- public_create_support_request: a real submission, called as service_role
  -- (the role the Vercel serverless function actually uses) ------------------

  v_hash := repeat('a1', 32);
  EXECUTE 'SET LOCAL ROLE service_role';
  SELECT * FROM public.public_create_support_request(
    'Cliente Web', 'cliente-web@example.test', '+54 9 11 1234-5678', 'shipping', 'Mi pedido no llego', 'Hola, todavia no me llego mi pedido.', 'RHB-202610-000099', gen_random_uuid(), v_hash
  ) INTO v_row;
  EXECUTE 'RESET ROLE';

  IF v_row.status <> 'open' THEN RAISE EXCEPTION 'web submission is not open by default'; END IF;
  INSERT INTO admin_03b_results VALUES ('public submission is created open', true, 'status=open');

  IF v_row.source <> 'web' THEN RAISE EXCEPTION 'web submission source is not web'; END IF;
  INSERT INTO admin_03b_results VALUES ('public submission source is web', true, 'source=web');

  IF v_row.created_by IS NOT NULL THEN RAISE EXCEPTION 'web submission has a non-null created_by'; END IF;
  INSERT INTO admin_03b_results VALUES ('public submission created_by is NULL', true, 'created_by=NULL');

  IF v_row.internal_notes IS NOT NULL THEN RAISE EXCEPTION 'web submission has non-null internal_notes'; END IF;
  INSERT INTO admin_03b_results VALUES ('public submission internal_notes is NULL', true, 'internal_notes=NULL');

  IF v_row.topic <> 'shipping' THEN RAISE EXCEPTION 'public_create_support_request did not store the submitted topic'; END IF;
  INSERT INTO admin_03b_results VALUES ('public_create_support_request stores the topic it received', true, 'topic=shipping');

  IF v_row.order_reference <> 'RHB-202610-000099' THEN RAISE EXCEPTION 'order_reference was not stored as free text'; END IF;
  INSERT INTO admin_03b_results VALUES ('order_reference is stored as submitted free text', true, 'stored');

  -- source stays web regardless of which valid topic is submitted -----------

  v_hash := repeat('b2', 32);
  EXECUTE 'SET LOCAL ROLE service_role';
  SELECT * FROM public.public_create_support_request(
    'Cliente Web 2', 'cliente-web-2@example.test', NULL, 'advice', NULL, 'Quisiera asesoramiento para elegir un producto.', NULL, gen_random_uuid(), v_hash
  ) INTO v_row;
  EXECUTE 'RESET ROLE';
  IF v_row.source <> 'web' THEN RAISE EXCEPTION 'source changed away from web for a different topic'; END IF;
  INSERT INTO admin_03b_results VALUES ('source stays web independently of topic', true, 'source=web');

  -- subject stays optional end-to-end through the public RPC too ------------

  IF v_row.subject IS NOT NULL THEN RAISE EXCEPTION 'absent subject was not normalized to NULL on the public RPC'; END IF;
  INSERT INTO admin_03b_results VALUES ('public submission: absent subject normalizes to NULL', true, 'subject=NULL');

  -- topic: every valid value is accepted -------------------------------------

  FOREACH v_topic IN ARRAY v_allowed_topics
  LOOP
    -- md5() gives 32 hex chars; two distinct md5s concatenated give exactly
    -- the 64 hex chars subject_hash requires, still a valid-format value.
    v_hash := md5('topic-loop-' || v_topic) || md5('topic-loop-salt-' || v_topic);
    EXECUTE 'SET LOCAL ROLE service_role';
    SELECT * FROM public.public_create_support_request(
      'Cliente Topic', 'cliente-topic-' || v_topic || '@example.test', NULL, v_topic, NULL, 'Mensaje de prueba para el motivo ' || v_topic || '.', NULL, gen_random_uuid(), v_hash
    ) INTO v_row;
    EXECUTE 'RESET ROLE';
    IF v_row.topic <> v_topic THEN RAISE EXCEPTION 'topic % was not stored correctly', v_topic; END IF;
  END LOOP;
  INSERT INTO admin_03b_results VALUES ('every one of the 8 allowed topic values is accepted', true, '8/8');

  -- topic: an unrecognized value is rejected ---------------------------------

  v_denied := false;
  EXECUTE 'SET LOCAL ROLE service_role';
  BEGIN
    PERFORM public.public_create_support_request('Cliente', 'cliente-bad-topic@example.test', NULL, 'not_a_real_topic', NULL, 'Mensaje.', NULL, gen_random_uuid(), repeat('c3', 32));
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE;
    v_denied := v_sqlstate = 'ADM22';
  END;
  EXECUTE 'RESET ROLE';
  IF NOT v_denied THEN RAISE EXCEPTION 'an invalid topic was accepted'; END IF;
  INSERT INTO admin_03b_results VALUES ('an unrecognized topic value is rejected', true, 'ADM22');

  -- admin-created rows (existing, untouched RPC) default topic/source -------

  EXECUTE 'SET LOCAL ROLE authenticated';
  PERFORM set_config('request.jwt.claim.sub', v_admin_id::text, true);
  SELECT * FROM public.admin_create_support_request('Cliente Admin', 'cliente-admin@example.test', NULL, 'Consulta registrada por staff', 'Mensaje tomado por telefono.', NULL, gen_random_uuid()) INTO v_admin_row;
  EXECUTE 'RESET ROLE';

  IF v_admin_row.topic <> 'general' THEN RAISE EXCEPTION 'an admin-created ticket did not default topic to general'; END IF;
  INSERT INTO admin_03b_results VALUES ('admin-created ticket defaults topic to general', true, 'topic=general');

  IF v_admin_row.source <> 'admin' THEN RAISE EXCEPTION 'an admin-created ticket did not default source to admin'; END IF;
  INSERT INTO admin_03b_results VALUES ('admin-created ticket defaults source to admin', true, 'source=admin');

  -- order_reference: oversized is rejected -----------------------------------

  v_denied := false;
  EXECUTE 'SET LOCAL ROLE service_role';
  BEGIN
    PERFORM public.public_create_support_request('Cliente', 'cliente-ref@example.test', NULL, 'general', NULL, 'Mensaje.', repeat('x', 61), gen_random_uuid(), repeat('d4', 32));
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE;
    v_denied := v_sqlstate = 'ADM22';
  END;
  EXECUTE 'RESET ROLE';
  IF NOT v_denied THEN RAISE EXCEPTION 'an oversized order_reference was accepted'; END IF;
  INSERT INTO admin_03b_results VALUES ('an oversized order_reference is rejected', true, 'ADM22');

  -- same field validation as the admin RPC, re-verified on the public one ---

  v_denied := false;
  EXECUTE 'SET LOCAL ROLE service_role';
  BEGIN
    PERFORM public.public_create_support_request('', 'cliente@example.test', NULL, 'general', NULL, 'Mensaje.', NULL, gen_random_uuid(), repeat('e5', 32));
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE;
    v_denied := v_sqlstate = 'ADM22';
  END;
  EXECUTE 'RESET ROLE';
  IF NOT v_denied THEN RAISE EXCEPTION 'an empty customer_name was accepted on the public RPC'; END IF;
  INSERT INTO admin_03b_results VALUES ('public RPC rejects an empty customer_name', true, 'ADM22');

  v_denied := false;
  EXECUTE 'SET LOCAL ROLE service_role';
  BEGIN
    PERFORM public.public_create_support_request('Cliente', 'not-an-email', NULL, 'general', NULL, 'Mensaje.', NULL, gen_random_uuid(), repeat('f6', 32));
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE;
    v_denied := v_sqlstate = 'ADM22';
  END;
  EXECUTE 'RESET ROLE';
  IF NOT v_denied THEN RAISE EXCEPTION 'a malformed email was accepted on the public RPC'; END IF;
  INSERT INTO admin_03b_results VALUES ('public RPC rejects a malformed customer_email', true, 'ADM22');

  v_denied := false;
  EXECUTE 'SET LOCAL ROLE service_role';
  BEGIN
    PERFORM public.public_create_support_request('Cliente', 'cliente@example.test', NULL, 'general', NULL, '', NULL, gen_random_uuid(), repeat('07', 32));
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE;
    v_denied := v_sqlstate = 'ADM22';
  END;
  EXECUTE 'RESET ROLE';
  IF NOT v_denied THEN RAISE EXCEPTION 'an empty message was accepted on the public RPC'; END IF;
  INSERT INTO admin_03b_results VALUES ('public RPC rejects an empty message', true, 'ADM22');

  v_denied := false;
  EXECUTE 'SET LOCAL ROLE service_role';
  BEGIN
    PERFORM public.public_create_support_request('Cliente', 'cliente@example.test', NULL, 'general', NULL, 'Mensaje.', NULL, NULL, repeat('18', 32));
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE;
    v_denied := v_sqlstate = 'ADM22';
  END;
  EXECUTE 'RESET ROLE';
  IF NOT v_denied THEN RAISE EXCEPTION 'a NULL request_id was accepted on the public RPC'; END IF;
  INSERT INTO admin_03b_results VALUES ('public RPC rejects a NULL request_id', true, 'ADM22');

  v_denied := false;
  EXECUTE 'SET LOCAL ROLE service_role';
  BEGIN
    PERFORM public.public_create_support_request('Cliente', 'cliente@example.test', NULL, 'general', NULL, 'Mensaje.', NULL, gen_random_uuid(), 'not-a-valid-hash');
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE;
    v_denied := v_sqlstate = 'ADM22';
  END;
  EXECUTE 'RESET ROLE';
  IF NOT v_denied THEN RAISE EXCEPTION 'a malformed rate-limit subject hash was accepted'; END IF;
  INSERT INTO admin_03b_results VALUES ('public RPC rejects a malformed rate-limit subject hash', true, 'ADM22');

  -- rate limiting: 5 allowed per window, the 6th is blocked ------------------

  v_hash := repeat('29', 32);
  FOR v_count IN 1..5 LOOP
    EXECUTE 'SET LOCAL ROLE service_role';
    PERFORM public.public_create_support_request('Rate Limit', 'rate-' || v_count || '@example.test', NULL, 'general', NULL, 'Mensaje de prueba de rate limit.', NULL, gen_random_uuid(), v_hash);
    EXECUTE 'RESET ROLE';
  END LOOP;

  v_denied := false;
  BEGIN
    EXECUTE 'SET LOCAL ROLE service_role';
    PERFORM public.public_create_support_request('Rate Limit', 'rate-6@example.test', NULL, 'general', NULL, 'Mensaje de prueba de rate limit.', NULL, gen_random_uuid(), v_hash);
    EXECUTE 'RESET ROLE';
  EXCEPTION WHEN OTHERS THEN
    EXECUTE 'RESET ROLE';
    GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE;
    v_denied := v_sqlstate = 'ADM29';
  END;
  IF NOT v_denied THEN RAISE EXCEPTION 'a 6th submission in the same window was not rate-limited'; END IF;
  INSERT INTO admin_03b_results VALUES ('a 6th submission from the same subject in one window is rate-limited', true, 'ADM29');

  -- a different subject hash is unaffected by another subject's rate limit --

  EXECUTE 'SET LOCAL ROLE service_role';
  SELECT * FROM public.public_create_support_request('Otro Cliente', 'otro-subject@example.test', NULL, 'general', NULL, 'Mensaje de otro visitante.', NULL, gen_random_uuid(), repeat('3a', 32)) INTO v_row;
  EXECUTE 'RESET ROLE';
  IF v_row.status <> 'open' THEN RAISE EXCEPTION 'a different rate-limit subject was unexpectedly blocked'; END IF;
  INSERT INTO admin_03b_results VALUES ('a different rate-limit subject is unaffected by another one''s limit', true, 'allowed');
END $$;

SELECT test_name, ok, detail
FROM admin_03b_results
ORDER BY test_name;

SELECT count(*) AS assertions, bool_and(ok) AS all_passed
FROM admin_03b_results;

ROLLBACK;
