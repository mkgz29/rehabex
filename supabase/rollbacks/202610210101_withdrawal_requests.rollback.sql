BEGIN;

-- SAFETY GUARD: this rollback drops request_kind, request_code and response_due_at.
-- It aborts if any withdrawal request exists, so legally relevant data is never lost silently.
-- If it aborts: export public.support_requests WHERE request_kind = 'withdrawal'
-- (including request_code and response_due_at), then resolve/archive them before retrying.
DO $guard$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.support_requests
    WHERE request_kind = 'withdrawal' OR request_code IS NOT NULL OR response_due_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Rollback aborted: withdrawal requests exist in public.support_requests. Back them up first.';
  END IF;
END
$guard$;

REVOKE ALL ON FUNCTION public.public_create_withdrawal_request(text, text, text, text, text, uuid, text)
  FROM PUBLIC, anon, authenticated, service_role;
DROP FUNCTION IF EXISTS public.public_create_withdrawal_request(text, text, text, text, text, uuid, text);

DROP INDEX IF EXISTS public.idx_support_requests_open_withdrawal_deadline;
DROP INDEX IF EXISTS public.idx_support_requests_request_code;

ALTER TABLE public.support_requests
  DROP CONSTRAINT IF EXISTS support_requests_withdrawal_fields_check,
  DROP CONSTRAINT IF EXISTS support_requests_request_code_format_check,
  DROP CONSTRAINT IF EXISTS support_requests_request_kind_check,
  DROP COLUMN IF EXISTS response_due_at,
  DROP COLUMN IF EXISTS request_code,
  DROP COLUMN IF EXISTS request_kind;

COMMIT;
