BEGIN;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.payment_events
    WHERE dedupe_key LIKE 'payment:%:status:%'
  ) THEN
    RAISE EXCEPTION 'Cannot roll back migration 106 while atomic payment events exist';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.process_mercadopago_payment_atomic(text, text, text, text, text, numeric, text, boolean, text)
  FROM PUBLIC, anon, authenticated, service_role;
DROP FUNCTION IF EXISTS public.process_mercadopago_payment_atomic(text, text, text, text, text, numeric, text, boolean, text);
DROP INDEX IF EXISTS public.idx_payment_events_provider_payment_status_unique;

COMMIT;
