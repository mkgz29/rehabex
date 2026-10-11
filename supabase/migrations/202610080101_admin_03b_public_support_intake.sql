BEGIN;

-- ADMIN-03B: public support intake. Adds a single, narrow write path for an
-- anonymous site visitor to create a support_requests row, without granting
-- anon any read access, any status/notes control, or any ability to assume
-- another actor's identity. Purely additive to ADMIN-03A: no existing 03A
-- object is dropped or redefined, only evolved (DROP NOT NULL / ADD COLUMN),
-- exactly like 102 evolved what 101 created.

-- 1. support_requests: evolve for a second, unauthenticated origin ----------

-- A web-origin ticket has no admin actor to attribute. Existing (admin-origin)
-- rows are untouched -- they already have a non-null created_by.
ALTER TABLE public.support_requests ALTER COLUMN "created_by" DROP NOT NULL;

-- Free-text, never queried or joined. A public visitor cannot be trusted to
-- supply a real order id, and validating one against public.orders from an
-- anonymous RPC would turn the field into an enumeration oracle (probe
-- numbers, learn which exist). This column exists purely so the admin
-- reading the ticket has the customer's own reference string on hand.
ALTER TABLE public.support_requests
  ADD COLUMN IF NOT EXISTS "order_reference" text,
  ADD CONSTRAINT "support_requests_order_reference_length_check" CHECK (char_length("order_reference") <= 60);

-- Distinguishes an admin-logged case from a visitor-submitted one. Existing
-- rows backfill to 'admin' via the column default -- they could only have
-- been created through admin_create_support_request, which this migration
-- does not touch (it keeps inserting without naming this column, so it
-- always takes the default).
ALTER TABLE public.support_requests
  ADD COLUMN IF NOT EXISTS "source" text NOT NULL DEFAULT 'admin',
  ADD CONSTRAINT "support_requests_source_check" CHECK ("source" IN ('admin', 'web'));

-- A closed set, not free text: "motivo de consulta" is a fixed taxonomy, not
-- a label the customer invents. Existing/admin-created rows default to
-- 'general' until the admin form is deliberately extended to collect it.
ALTER TABLE public.support_requests
  ADD COLUMN IF NOT EXISTS "topic" text NOT NULL DEFAULT 'general',
  ADD CONSTRAINT "support_requests_topic_check" CHECK (
    "topic" IN ('product', 'order', 'shipping', 'payment', 'returns_warranty', 'advice', 'general', 'other')
  );

-- 2. Rate limiting -- isolated from checkout's, by design -------------------

-- A dedicated table, not a new scope on public.commerce_rate_limit_windows:
-- that table and its consume_commerce_rate_limit() function belong to
-- checkout/payments, explicitly out of scope for this phase. Same proven
-- shape (hashed subject, fixed window, monotonic counter), zero shared
-- surface with commerce.
CREATE TABLE IF NOT EXISTS "public"."support_intake_rate_limit_windows" (
  "subject_hash" text NOT NULL CHECK ("subject_hash" ~ '^[a-f0-9]{64}$'),
  "window_started_at" timestamptz NOT NULL,
  "request_count" integer NOT NULL CHECK ("request_count" >= 0),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("subject_hash", "window_started_at")
);

ALTER TABLE "public"."support_intake_rate_limit_windows" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."support_intake_rate_limit_windows" FORCE ROW LEVEL SECURITY;
ALTER TABLE "public"."support_intake_rate_limit_windows" OWNER TO "postgres";

CREATE INDEX IF NOT EXISTS "idx_support_intake_rate_limit_windows_expiry"
  ON "public"."support_intake_rate_limit_windows" ("window_started_at");

-- No policy at all: no client role has any direct access, matching
-- support_requests' own no-policy-for-writes pattern. Every touch goes
-- through the SECURITY DEFINER function below, which is itself not granted
-- to anon -- only public_create_support_request (also SECURITY DEFINER, so
-- it runs as owner regardless of the caller's own grants) calls it.
REVOKE ALL ON TABLE "public"."support_intake_rate_limit_windows" FROM PUBLIC, "anon", "authenticated", "service_role";

CREATE OR REPLACE FUNCTION "public"."consume_support_intake_rate_limit"(
  "p_subject_hash" text
) RETURNS TABLE ("allowed" boolean, "retry_after_seconds" integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_window_seconds integer := 600; -- 10 minutes
  v_limit integer := 5;
  v_window_started_at timestamptz;
  v_count integer;
  v_retry integer;
BEGIN
  IF p_subject_hash IS NULL OR p_subject_hash !~ '^[a-f0-9]{64}$' THEN
    RAISE EXCEPTION 'invalid_subject' USING ERRCODE = 'ADM22';
  END IF;

  v_window_started_at := to_timestamp(floor(extract(epoch FROM clock_timestamp()) / v_window_seconds) * v_window_seconds);
  v_retry := GREATEST(1, ceil(extract(epoch FROM (v_window_started_at + make_interval(secs => v_window_seconds)) - clock_timestamp()))::integer);

  PERFORM pg_advisory_xact_lock(hashtextextended('support_intake:' || p_subject_hash, 0));

  SELECT request_count INTO v_count
  FROM public.support_intake_rate_limit_windows
  WHERE subject_hash = p_subject_hash AND window_started_at = v_window_started_at
  FOR UPDATE;

  IF FOUND AND v_count >= v_limit THEN
    RETURN QUERY SELECT false, v_retry;
    RETURN;
  END IF;

  INSERT INTO public.support_intake_rate_limit_windows (subject_hash, window_started_at, request_count, updated_at)
  VALUES (p_subject_hash, v_window_started_at, 1, now())
  ON CONFLICT (subject_hash, window_started_at)
  DO UPDATE SET request_count = public.support_intake_rate_limit_windows.request_count + 1, updated_at = now();

  RETURN QUERY SELECT true, 0;
END;
$$;

REVOKE ALL ON FUNCTION "public"."consume_support_intake_rate_limit"(text) FROM PUBLIC, "anon", "authenticated";
GRANT EXECUTE ON FUNCTION "public"."consume_support_intake_rate_limit"(text) TO "service_role";
-- Same principle as public_create_support_request: no client role gets this
-- directly. It is reachable two ways, both server-side -- from inside
-- public_create_support_request (which runs as owner regardless of the
-- caller's own grants) and directly as service_role for any future
-- server-side use. Calling it straight from the browser would let an
-- attacker exhaust/probe the counter outside the real flow.

CREATE OR REPLACE FUNCTION "public"."purge_support_intake_rate_limit_windows"()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_deleted integer;
BEGIN
  DELETE FROM public.support_intake_rate_limit_windows
  WHERE window_started_at < now() - interval '1 day';
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

REVOKE ALL ON FUNCTION "public"."purge_support_intake_rate_limit_windows"() FROM PUBLIC, "anon", "authenticated";
GRANT EXECUTE ON FUNCTION "public"."purge_support_intake_rate_limit_windows"() TO "service_role";

-- 3. Public create RPC --------------------------------------------------------

CREATE OR REPLACE FUNCTION "public"."public_create_support_request"(
  "p_customer_name" text,
  "p_customer_email" text,
  "p_customer_phone" text,
  "p_topic" text,
  "p_subject" text,
  "p_message" text,
  "p_order_reference" text,
  "p_request_id" uuid,
  "p_rate_limit_subject_hash" text
) RETURNS "public"."support_requests"
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_customer_name text := btrim(COALESCE(p_customer_name, ''));
  v_customer_email text := btrim(COALESCE(p_customer_email, ''));
  v_customer_phone text := NULLIF(btrim(COALESCE(p_customer_phone, '')), '');
  v_topic text := btrim(COALESCE(p_topic, ''));
  v_subject text := NULLIF(btrim(COALESCE(p_subject, '')), '');
  v_message text := btrim(COALESCE(p_message, ''));
  v_order_reference text := NULLIF(btrim(COALESCE(p_order_reference, '')), '');
  v_rate_ok boolean;
  v_retry integer;
  v_row public.support_requests;
BEGIN
  IF p_request_id IS NULL THEN RAISE EXCEPTION 'invalid_request' USING ERRCODE = 'ADM22'; END IF;

  SELECT allowed, retry_after_seconds INTO v_rate_ok, v_retry
  FROM public.consume_support_intake_rate_limit(p_rate_limit_subject_hash);
  IF NOT v_rate_ok THEN
    RAISE EXCEPTION 'rate_limited' USING ERRCODE = 'ADM29', DETAIL = v_retry::text;
  END IF;

  IF v_customer_name = '' OR length(v_customer_name) > 160 THEN RAISE EXCEPTION 'invalid_customer_name' USING ERRCODE = 'ADM22'; END IF;
  IF v_customer_email = '' OR length(v_customer_email) > 254 OR v_customer_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN
    RAISE EXCEPTION 'invalid_customer_email' USING ERRCODE = 'ADM22';
  END IF;
  IF v_customer_phone IS NOT NULL AND length(v_customer_phone) > 40 THEN RAISE EXCEPTION 'invalid_customer_phone' USING ERRCODE = 'ADM22'; END IF;
  -- Defense in depth: the column CHECK would also reject this, but failing
  -- here keeps the error vocabulary consistent with every other field
  -- instead of leaking a raw Postgres constraint-violation message.
  IF v_topic NOT IN ('product', 'order', 'shipping', 'payment', 'returns_warranty', 'advice', 'general', 'other') THEN
    RAISE EXCEPTION 'invalid_topic' USING ERRCODE = 'ADM22';
  END IF;
  IF v_subject IS NOT NULL AND length(v_subject) > 200 THEN RAISE EXCEPTION 'invalid_subject' USING ERRCODE = 'ADM22'; END IF;
  IF v_message = '' OR length(v_message) > 4000 THEN RAISE EXCEPTION 'invalid_message' USING ERRCODE = 'ADM22'; END IF;
  IF v_order_reference IS NOT NULL AND length(v_order_reference) > 60 THEN RAISE EXCEPTION 'invalid_order_reference' USING ERRCODE = 'ADM22'; END IF;

  -- source/status/internal_notes/created_by are never parameters: there is
  -- no way for a caller to influence them, by construction, not by convention.
  INSERT INTO public.support_requests (
    customer_name, customer_email, customer_phone, topic, subject, message, status, order_reference, source, created_by
  ) VALUES (
    v_customer_name, v_customer_email, v_customer_phone, v_topic, v_subject, v_message, 'open', v_order_reference, 'web', NULL
  ) RETURNING * INTO v_row;

  RETURN v_row;
EXCEPTION
  WHEN unique_violation THEN RAISE EXCEPTION 'duplicate_request' USING ERRCODE = 'ADM09';
END;
$$;

-- No admin_audit_events row: that table is admin accountability (who, which
-- admin, did what), not a general event log, and a web submission has no
-- admin actor to attribute (admin_audit_events.actor_id is NOT NULL, and
-- widening that is out of scope here). Application-level logEvent() in the
-- serverless handler covers operational visibility the same way checkout
-- already does for its own public endpoint.

-- The browser never talks to this RPC directly. The only approved path is
-- Browser -> POST /api/support-intake -> Vercel serverless (service_role) ->
-- this RPC. anon gets nothing here, matching how checkout's own rate-limit
-- RPC is only ever called via serviceClient() from inside a serverless
-- function, never from the browser's anon-key client.
REVOKE ALL ON FUNCTION "public"."public_create_support_request"(text, text, text, text, text, text, text, uuid, text) FROM PUBLIC, "anon", "authenticated";
GRANT EXECUTE ON FUNCTION "public"."public_create_support_request"(text, text, text, text, text, text, text, uuid, text) TO "service_role";

COMMIT;
