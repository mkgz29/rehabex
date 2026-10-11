-- Manual rollback for ADMIN-03C (support_requests 'archived' status).
--
-- Reverts the status CHECK constraint and both RPC bodies to their exact
-- 03A shape. The constraint step only succeeds if no archived rows exist
-- yet -- true for a fresh local test cycle, not guaranteed once real
-- archiving has happened. Local use only; never run against remote without
-- the same explicit review a forward migration gets.

BEGIN;

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
  IF p_status IS NOT NULL AND p_status NOT IN ('open', 'answered', 'resolved') THEN
    RAISE EXCEPTION 'invalid_status' USING ERRCODE = 'ADM22';
  END IF;

  RETURN QUERY
  SELECT * FROM public.support_requests
  WHERE p_status IS NULL OR status = p_status
  ORDER BY created_at DESC;
END;
$$;

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
  IF p_status NOT IN ('open', 'answered', 'resolved') THEN RAISE EXCEPTION 'invalid_status' USING ERRCODE = 'ADM22'; END IF;

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

ALTER TABLE "public"."support_requests" DROP CONSTRAINT "support_requests_status_check";
ALTER TABLE "public"."support_requests"
  ADD CONSTRAINT "support_requests_status_check" CHECK ("status" IN ('open', 'answered', 'resolved'));

COMMIT;
