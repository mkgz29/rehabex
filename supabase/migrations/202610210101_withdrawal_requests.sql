BEGIN;

-- A withdrawal request shares the existing protected admin support inbox,
-- while remaining an explicit case type with its own public reference and
-- 24-hour response deadline. Existing support rows retain their behavior.
ALTER TABLE public.support_requests
  ADD COLUMN IF NOT EXISTS request_kind text NOT NULL DEFAULT 'support',
  ADD COLUMN IF NOT EXISTS request_code text,
  ADD COLUMN IF NOT EXISTS response_due_at timestamptz;

ALTER TABLE public.support_requests
  ADD CONSTRAINT support_requests_request_kind_check
    CHECK (request_kind IN ('support', 'withdrawal')),
  ADD CONSTRAINT support_requests_request_code_format_check
    CHECK (request_code IS NULL OR request_code ~ '^ARR-[0-9]{8}-[A-F0-9]{8}$'),
  ADD CONSTRAINT support_requests_withdrawal_fields_check
    CHECK (
      (request_kind = 'support' AND request_code IS NULL AND response_due_at IS NULL)
      OR
      (request_kind = 'withdrawal' AND request_code IS NOT NULL AND response_due_at IS NOT NULL)
    );

CREATE UNIQUE INDEX IF NOT EXISTS idx_support_requests_request_code
  ON public.support_requests (request_code)
  WHERE request_code IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_support_requests_open_withdrawal_deadline
  ON public.support_requests (response_due_at)
  WHERE request_kind = 'withdrawal' AND status = 'open';

CREATE OR REPLACE FUNCTION public.public_create_withdrawal_request(
  p_customer_name text,
  p_customer_email text,
  p_customer_phone text,
  p_order_reference text,
  p_message text,
  p_request_id uuid,
  p_rate_limit_subject_hash text
) RETURNS public.support_requests
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_customer_name text := btrim(COALESCE(p_customer_name, ''));
  v_customer_email text := lower(btrim(COALESCE(p_customer_email, '')));
  v_customer_phone text := NULLIF(btrim(COALESCE(p_customer_phone, '')), '');
  v_order_reference text := btrim(COALESCE(p_order_reference, ''));
  v_message text := NULLIF(btrim(COALESCE(p_message, '')), '');
  v_rate_ok boolean;
  v_retry integer;
  v_id uuid := gen_random_uuid();
  v_code text;
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
  IF v_order_reference = '' OR length(v_order_reference) > 60 THEN RAISE EXCEPTION 'invalid_order_reference' USING ERRCODE = 'ADM22'; END IF;
  IF v_message IS NOT NULL AND length(v_message) > 2000 THEN RAISE EXCEPTION 'invalid_message' USING ERRCODE = 'ADM22'; END IF;

  v_code := 'ARR-' || to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYYMMDD') || '-' || upper(substr(replace(v_id::text, '-', ''), 1, 8));

  -- The order number remains untrusted free text. This function deliberately
  -- does not query, link, update or reveal an order, payment or refund.
  INSERT INTO public.support_requests (
    id, customer_name, customer_email, customer_phone, topic, subject, message,
    status, order_id, order_reference, source, created_by, request_kind,
    request_code, response_due_at
  ) VALUES (
    v_id, v_customer_name, v_customer_email, v_customer_phone,
    'returns_warranty', 'Solicitud de arrepentimiento',
    COALESCE(v_message, 'Sin comentarios adicionales.'),
    'open', NULL, v_order_reference, 'web', NULL, 'withdrawal',
    v_code, now() + interval '24 hours'
  ) RETURNING * INTO v_row;

  RETURN v_row;
EXCEPTION
  WHEN unique_violation THEN RAISE EXCEPTION 'duplicate_request' USING ERRCODE = 'ADM09';
END;
$$;

REVOKE ALL ON FUNCTION public.public_create_withdrawal_request(text, text, text, text, text, uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.public_create_withdrawal_request(text, text, text, text, text, uuid, text)
  TO service_role;

COMMIT;
