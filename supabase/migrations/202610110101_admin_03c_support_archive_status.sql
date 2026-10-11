BEGIN;

-- ADMIN-03C: adds the 'archived' status to support_requests (FASE 7D.2).
-- Purely additive: no column added, no row touched, no data removed, no
-- client-facing access changed. Archiving a ticket is just another status
-- transition through the same existing RPC/RLS boundary as
-- open/answered/resolved -- it never deletes anything, it only lets the
-- admin inbox filter it out of the default view.

-- 1. Widen the status CHECK constraint ----------------------------------------

ALTER TABLE "public"."support_requests" DROP CONSTRAINT "support_requests_status_check";
ALTER TABLE "public"."support_requests"
  ADD CONSTRAINT "support_requests_status_check" CHECK ("status" IN ('open', 'answered', 'resolved', 'archived'));

-- 2. Allow 'archived' through the existing RPCs (signatures unchanged) -------

CREATE OR REPLACE FUNCTION "public"."admin_update_support_request_status"(
  "p_support_request_id" uuid,
  "p_status" text,
  "p_expected_updated_at" timestamptz,
  "p_request_id" uuid
) RETURNS "public"."support_requests"
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_before public.support_requests;
  v_after public.support_requests;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE = 'ADM01'; END IF;
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = 'ADM03'; END IF;
  IF p_support_request_id IS NULL OR p_request_id IS NULL OR p_expected_updated_at IS NULL THEN
    RAISE EXCEPTION 'invalid_request' USING ERRCODE = 'ADM22';
  END IF;
  IF p_status NOT IN ('open', 'answered', 'resolved', 'archived') THEN RAISE EXCEPTION 'invalid_status' USING ERRCODE = 'ADM22'; END IF;

  SELECT * INTO v_before FROM public.support_requests WHERE id = p_support_request_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found' USING ERRCODE = 'ADM04'; END IF;
  IF v_before.updated_at <> p_expected_updated_at THEN RAISE EXCEPTION 'version_conflict' USING ERRCODE = 'ADM09'; END IF;

  IF v_before.status = p_status THEN
    RETURN v_before;
  END IF;

  UPDATE public.support_requests SET status = p_status WHERE id = p_support_request_id RETURNING * INTO v_after;

  INSERT INTO public.admin_audit_events (actor_id, action, entity_type, entity_id, request_id, before_state, after_state)
  VALUES (
    v_actor, 'support_request.status_changed', 'support_request', v_after.id::text, p_request_id,
    jsonb_build_object('status', v_before.status),
    jsonb_build_object('status', v_after.status)
  );

  RETURN v_after;
EXCEPTION
  WHEN unique_violation THEN RAISE EXCEPTION 'duplicate_request' USING ERRCODE = 'ADM09';
END;
$$;

CREATE OR REPLACE FUNCTION "public"."admin_list_support_requests"(
  "p_status" text DEFAULT NULL
) RETURNS SETOF "public"."support_requests"
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE = 'ADM01'; END IF;
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = 'ADM03'; END IF;
  IF p_status IS NOT NULL AND p_status NOT IN ('open', 'answered', 'resolved', 'archived') THEN
    RAISE EXCEPTION 'invalid_status' USING ERRCODE = 'ADM22';
  END IF;

  -- Unchanged: a NULL filter still returns every row regardless of status.
  -- "Todas" excluding archived is an admin-side UI decision (the client
  -- passes an explicit multi-status filter), not something this RPC
  -- enforces -- the RPC's job is just "what this exact filter asked for".
  RETURN QUERY
  SELECT * FROM public.support_requests
  WHERE p_status IS NULL OR status = p_status
  ORDER BY created_at DESC;
END;
$$;

-- No grant changes: both functions keep their exact existing signatures, so
-- the REVOKE/GRANT pairs already in place from 03A apply unchanged. RLS
-- policy ("admin read support requests", USING (public.is_admin())) is
-- untouched -- it was never status-dependent to begin with.

COMMIT;
