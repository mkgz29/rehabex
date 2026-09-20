BEGIN;

-- Reverses 202609110109. Restores the pre-109 dedupe: ANY existing event row
-- for a (provider, payment, status) makes a replay a duplicate.
--
-- IMPORTANT: once retries have happened, this rollback can legitimately fail.
-- The old schema cannot represent more than one row per (provider, payment,
-- status), per dedupe_key or per request_id, and 109 exists precisely so those
-- rows can accumulate. The guards below abort with a clear message instead of
-- silently deleting audit history. Resolve the duplicates deliberately first —
-- never by deleting production rows without a decision.

DO $$
DECLARE
  v_conflicts integer;
BEGIN
  SELECT count(*) INTO v_conflicts FROM (
    SELECT 1 FROM public.payment_events
    WHERE provider_payment_id IS NOT NULL AND provider_status IS NOT NULL
    GROUP BY provider, provider_payment_id, provider_status HAVING count(*) > 1
  ) AS d;
  IF v_conflicts > 0 THEN
    RAISE EXCEPTION 'cannot restore pre-109 uniqueness: % (provider,payment,status) groups hold retry history', v_conflicts;
  END IF;

  SELECT count(*) INTO v_conflicts FROM (
    SELECT 1 FROM public.payment_events WHERE dedupe_key IS NOT NULL
    GROUP BY provider, dedupe_key HAVING count(*) > 1
  ) AS d;
  IF v_conflicts > 0 THEN
    RAISE EXCEPTION 'cannot restore pre-109 uniqueness: % dedupe_key groups hold retry history', v_conflicts;
  END IF;

  SELECT count(*) INTO v_conflicts FROM (
    SELECT 1 FROM public.payment_events WHERE request_id IS NOT NULL
    GROUP BY provider, request_id HAVING count(*) > 1
  ) AS d;
  IF v_conflicts > 0 THEN
    RAISE EXCEPTION 'cannot restore pre-109 uniqueness: % request_id groups hold retry history', v_conflicts;
  END IF;
END
$$;

DROP INDEX IF EXISTS public.idx_payment_events_processed_payment_status_unique;
DROP INDEX IF EXISTS public.idx_payment_events_processed_dedupe_unique;
DROP INDEX IF EXISTS public.idx_payment_events_processed_request_unique;
DROP INDEX IF EXISTS public.idx_payment_events_provider_payment_status;

CREATE UNIQUE INDEX IF NOT EXISTS "idx_payment_events_provider_payment_status_unique"
  ON public.payment_events (provider, provider_payment_id, provider_status)
  WHERE provider_payment_id IS NOT NULL AND provider_status IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "idx_payment_events_provider_dedupe_unique"
  ON public.payment_events (provider, dedupe_key)
  WHERE dedupe_key IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "idx_payment_events_provider_request_unique"
  ON public.payment_events (provider, request_id)
  WHERE request_id IS NOT NULL;

-- The function body is restored by re-applying migration 202609110106, whose
-- dedupe SELECT has no `status = 'processed'` predicate.

COMMIT;
