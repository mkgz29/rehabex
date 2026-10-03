BEGIN;

-- ADMIN-03A: foundation for the admin Support inbox (Centro de Soporte).
-- v1 is a single flat table (no threads/messages): staff log a support case
-- themselves when a customer reaches out by phone, email or WhatsApp -- there
-- is no public submission endpoint in this phase. Every column is admin-only,
-- following the exact ADMIN-01B/01C pattern: RLS enabled+forced, no client
-- INSERT/UPDATE/DELETE policy at all, every write goes through a SECURITY
-- DEFINER RPC that re-checks auth.uid() and public.is_admin() itself, and
-- every mutation is audited in admin_audit_events under the same request_id
-- convention. Reads also go through a SECURITY DEFINER RPC (not a direct
-- `.from()` select) so the admin API boundary stays uniform even though the
-- table's own RLS policy would already allow an admin SELECT directly.

-- 1. support_requests ---------------------------------------------------------

CREATE TABLE IF NOT EXISTS "public"."support_requests" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "customer_name" text NOT NULL,
  "customer_email" text NOT NULL,
  "customer_phone" text,
  "subject" text NOT NULL,
  "message" text NOT NULL,
  "status" text NOT NULL DEFAULT 'open',
  "order_id" uuid,
  "internal_notes" text,
  "created_by" uuid NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "support_requests_status_check" CHECK ("status" IN ('open', 'answered', 'resolved')),
  CONSTRAINT "support_requests_customer_email_format_check" CHECK ("customer_email" ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$')
);

ALTER TABLE "public"."support_requests"
  ADD CONSTRAINT "support_requests_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS "idx_support_requests_status_created" ON "public"."support_requests" ("status", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "idx_support_requests_order_id" ON "public"."support_requests" ("order_id") WHERE "order_id" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "idx_support_requests_created_at" ON "public"."support_requests" ("created_at" DESC);

ALTER TABLE ONLY "public"."support_requests" FORCE ROW LEVEL SECURITY;
ALTER TABLE "public"."support_requests" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."support_requests" OWNER TO "postgres";

DROP TRIGGER IF EXISTS "set_updated_at" ON "public"."support_requests";
CREATE TRIGGER "set_updated_at"
BEFORE UPDATE ON "public"."support_requests"
FOR EACH ROW
EXECUTE FUNCTION "public"."update_updated_at_column"();

-- No INSERT/UPDATE/DELETE policy exists for any client role, including
-- authenticated admins. Every writer is a SECURITY DEFINER RPC below, which
-- runs as the table owner and is therefore unaffected by RLS or by the
-- absence of a client grant.
DROP POLICY IF EXISTS "admin read support requests" ON "public"."support_requests";
CREATE POLICY "admin read support requests"
ON "public"."support_requests"
FOR SELECT
TO "authenticated"
USING (public.is_admin());

REVOKE ALL ON TABLE "public"."support_requests" FROM PUBLIC, "anon", "authenticated", "service_role";
GRANT SELECT ON TABLE "public"."support_requests" TO "authenticated";

-- 2. Create / read RPCs --------------------------------------------------------

CREATE OR REPLACE FUNCTION "public"."admin_create_support_request"(
  "p_customer_name" text,
  "p_customer_email" text,
  "p_customer_phone" text,
  "p_subject" text,
  "p_message" text,
  "p_order_id" uuid,
  "p_request_id" uuid
) RETURNS "public"."support_requests"
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_customer_name text := btrim(COALESCE(p_customer_name, ''));
  v_customer_email text := btrim(COALESCE(p_customer_email, ''));
  v_customer_phone text := NULLIF(btrim(COALESCE(p_customer_phone, '')), '');
  v_subject text := btrim(COALESCE(p_subject, ''));
  v_message text := btrim(COALESCE(p_message, ''));
  v_row public.support_requests;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE = 'ADM01'; END IF;
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = 'ADM03'; END IF;
  IF p_request_id IS NULL THEN RAISE EXCEPTION 'invalid_request' USING ERRCODE = 'ADM22'; END IF;

  IF v_customer_name = '' OR length(v_customer_name) > 160 THEN RAISE EXCEPTION 'invalid_customer_name' USING ERRCODE = 'ADM22'; END IF;
  IF v_customer_email = '' OR length(v_customer_email) > 254 OR v_customer_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN
    RAISE EXCEPTION 'invalid_customer_email' USING ERRCODE = 'ADM22';
  END IF;
  IF v_customer_phone IS NOT NULL AND length(v_customer_phone) > 40 THEN RAISE EXCEPTION 'invalid_customer_phone' USING ERRCODE = 'ADM22'; END IF;
  IF v_subject = '' OR length(v_subject) > 200 THEN RAISE EXCEPTION 'invalid_subject' USING ERRCODE = 'ADM22'; END IF;
  IF v_message = '' OR length(v_message) > 4000 THEN RAISE EXCEPTION 'invalid_message' USING ERRCODE = 'ADM22'; END IF;

  IF p_order_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.orders WHERE id = p_order_id) THEN
    RAISE EXCEPTION 'order_not_found' USING ERRCODE = 'ADM04';
  END IF;

  -- Always created open; status changes are a separate, audited operation.
  INSERT INTO public.support_requests (
    customer_name, customer_email, customer_phone, subject, message, status, order_id, created_by
  ) VALUES (
    v_customer_name, v_customer_email, v_customer_phone, v_subject, v_message, 'open', p_order_id, v_actor
  ) RETURNING * INTO v_row;

  INSERT INTO public.admin_audit_events (actor_id, action, entity_type, entity_id, request_id, before_state, after_state)
  VALUES (
    v_actor, 'support_request.created', 'support_request', v_row.id::text, p_request_id, NULL,
    jsonb_build_object(
      'customer_name', v_row.customer_name, 'customer_email', v_row.customer_email,
      'subject', v_row.subject, 'status', v_row.status, 'order_id', v_row.order_id
    )
  );

  RETURN v_row;
EXCEPTION
  WHEN unique_violation THEN RAISE EXCEPTION 'duplicate_request' USING ERRCODE = 'ADM09';
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

CREATE OR REPLACE FUNCTION "public"."admin_update_support_request_notes"(
  "p_support_request_id" uuid,
  "p_internal_notes" text,
  "p_expected_updated_at" timestamptz,
  "p_request_id" uuid
) RETURNS "public"."support_requests"
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_internal_notes text := NULLIF(btrim(COALESCE(p_internal_notes, '')), '');
  v_before public.support_requests;
  v_after public.support_requests;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE = 'ADM01'; END IF;
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = 'ADM03'; END IF;
  IF p_support_request_id IS NULL OR p_request_id IS NULL OR p_expected_updated_at IS NULL THEN
    RAISE EXCEPTION 'invalid_request' USING ERRCODE = 'ADM22';
  END IF;
  IF v_internal_notes IS NOT NULL AND length(v_internal_notes) > 4000 THEN RAISE EXCEPTION 'invalid_internal_notes' USING ERRCODE = 'ADM22'; END IF;

  SELECT * INTO v_before FROM public.support_requests WHERE id = p_support_request_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found' USING ERRCODE = 'ADM04'; END IF;
  IF v_before.updated_at <> p_expected_updated_at THEN RAISE EXCEPTION 'version_conflict' USING ERRCODE = 'ADM09'; END IF;

  IF v_before.internal_notes IS NOT DISTINCT FROM v_internal_notes THEN
    RETURN v_before;
  END IF;

  UPDATE public.support_requests SET internal_notes = v_internal_notes WHERE id = p_support_request_id RETURNING * INTO v_after;

  INSERT INTO public.admin_audit_events (actor_id, action, entity_type, entity_id, request_id, before_state, after_state)
  VALUES (
    v_actor, 'support_request.notes_updated', 'support_request', v_after.id::text, p_request_id,
    jsonb_build_object('internal_notes', v_before.internal_notes),
    jsonb_build_object('internal_notes', v_after.internal_notes)
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
  IF p_status IS NOT NULL AND p_status NOT IN ('open', 'answered', 'resolved') THEN
    RAISE EXCEPTION 'invalid_status' USING ERRCODE = 'ADM22';
  END IF;

  RETURN QUERY
  SELECT * FROM public.support_requests
  WHERE p_status IS NULL OR status = p_status
  ORDER BY created_at DESC;
END;
$$;

CREATE OR REPLACE FUNCTION "public"."admin_get_support_request"(
  "p_support_request_id" uuid
) RETURNS "public"."support_requests"
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_row public.support_requests;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE = 'ADM01'; END IF;
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = 'ADM03'; END IF;
  IF p_support_request_id IS NULL THEN RAISE EXCEPTION 'invalid_request' USING ERRCODE = 'ADM22'; END IF;

  SELECT * INTO v_row FROM public.support_requests WHERE id = p_support_request_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found' USING ERRCODE = 'ADM04'; END IF;

  RETURN v_row;
END;
$$;

-- 3. Grants: authenticated may call these RPCs, which validate admin
--    membership internally; no other client role may call them at all. -----

REVOKE ALL ON FUNCTION "public"."admin_create_support_request"(text, text, text, text, text, uuid, uuid) FROM PUBLIC, "anon", "authenticated";
REVOKE ALL ON FUNCTION "public"."admin_update_support_request_status"(uuid, text, timestamptz, uuid) FROM PUBLIC, "anon", "authenticated";
REVOKE ALL ON FUNCTION "public"."admin_update_support_request_notes"(uuid, text, timestamptz, uuid) FROM PUBLIC, "anon", "authenticated";
REVOKE ALL ON FUNCTION "public"."admin_list_support_requests"(text) FROM PUBLIC, "anon", "authenticated";
REVOKE ALL ON FUNCTION "public"."admin_get_support_request"(uuid) FROM PUBLIC, "anon", "authenticated";

GRANT EXECUTE ON FUNCTION "public"."admin_create_support_request"(text, text, text, text, text, uuid, uuid) TO "authenticated";
GRANT EXECUTE ON FUNCTION "public"."admin_update_support_request_status"(uuid, text, timestamptz, uuid) TO "authenticated";
GRANT EXECUTE ON FUNCTION "public"."admin_update_support_request_notes"(uuid, text, timestamptz, uuid) TO "authenticated";
GRANT EXECUTE ON FUNCTION "public"."admin_list_support_requests"(text) TO "authenticated";
GRANT EXECUTE ON FUNCTION "public"."admin_get_support_request"(uuid) TO "authenticated";

COMMIT;
