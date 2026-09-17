BEGIN;

-- PENDING: do not move this file into supabase/migrations or apply it yet.
-- Apply only after the rolling deployment has been verified: release 106 keeps
-- these grants so an older backend can finish its two-step payment flow.
REVOKE ALL ON FUNCTION public.record_mercadopago_payment_event(text, text, text, text, uuid, text, text, text)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.apply_mercadopago_payment_transition(uuid, uuid, text, text, numeric, text, text, text)
  FROM PUBLIC, anon, authenticated, service_role;

DROP FUNCTION public.apply_mercadopago_payment_transition(uuid, uuid, text, text, numeric, text, text, text);
DROP FUNCTION public.record_mercadopago_payment_event(text, text, text, text, uuid, text, text, text);

COMMIT;
