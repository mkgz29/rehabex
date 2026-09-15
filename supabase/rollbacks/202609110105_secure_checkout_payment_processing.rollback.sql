BEGIN;

-- Refuse a destructive rollback once the new checkout has persisted data.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.payment_events WHERE dedupe_key IS NOT NULL)
     OR EXISTS (SELECT 1 FROM public.orders WHERE refund_required = true)
     OR EXISTS (SELECT 1 FROM public.commerce_rate_limit_windows)
     OR EXISTS (SELECT 1 FROM public.orders WHERE mercadopago_preference_attempts > 0) THEN
    RAISE EXCEPTION 'cannot rollback 105 while 105 commerce data exists';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.apply_mercadopago_payment_transition(uuid, uuid, text, text, numeric, text, text, text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.record_mercadopago_payment_event(text, text, text, text, uuid, text, text, text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.attach_mercadopago_preference(uuid, text, text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.create_checkout_order_v2(uuid, text, uuid, text, text, text, public.delivery_method, jsonb, jsonb, text, integer) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.get_checkout_shipping_amount(public.delivery_method) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.commerce_rate_limit_windows FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.consume_commerce_rate_limit(text, text[]) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.purge_commerce_rate_limit_windows() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.claim_mercadopago_preference_creation(uuid, uuid, integer) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.complete_mercadopago_preference_creation(uuid, uuid, text, text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fail_mercadopago_preference_creation(uuid, uuid, text) FROM PUBLIC, anon, authenticated, service_role;
DO $$
BEGIN
  IF to_regprocedure('public.reconcile_mercadopago_preference_creation(uuid,boolean,text,text)') IS NOT NULL THEN
    REVOKE ALL ON FUNCTION public.reconcile_mercadopago_preference_creation(uuid, boolean, text, text) FROM PUBLIC, anon, authenticated, service_role;
  END IF;
END;
$$;

DROP FUNCTION IF EXISTS public.apply_mercadopago_payment_transition(uuid, uuid, text, text, numeric, text, text, text);
DROP FUNCTION IF EXISTS public.record_mercadopago_payment_event(text, text, text, text, uuid, text, text, text);
DROP FUNCTION IF EXISTS public.attach_mercadopago_preference(uuid, text, text);
DROP FUNCTION IF EXISTS public.create_checkout_order_v2(uuid, text, uuid, text, text, text, public.delivery_method, jsonb, jsonb, text, integer);
DROP FUNCTION IF EXISTS public.get_checkout_shipping_amount(public.delivery_method);
DROP FUNCTION IF EXISTS public.consume_commerce_rate_limit(text, text[]);
DROP FUNCTION IF EXISTS public.purge_commerce_rate_limit_windows();
DROP FUNCTION IF EXISTS public.claim_mercadopago_preference_creation(uuid, uuid, integer);
DROP FUNCTION IF EXISTS public.complete_mercadopago_preference_creation(uuid, uuid, text, text);
DROP FUNCTION IF EXISTS public.fail_mercadopago_preference_creation(uuid, uuid, text);
DROP FUNCTION IF EXISTS public.reconcile_mercadopago_preference_creation(uuid, boolean, text, text);

DROP INDEX IF EXISTS public.idx_payment_events_provider_dedupe_unique;
DROP INDEX IF EXISTS public.idx_commerce_rate_limit_windows_expiry;
DROP TABLE IF EXISTS public.commerce_rate_limit_windows;
ALTER TABLE public.payment_events DROP COLUMN IF EXISTS dedupe_key, DROP COLUMN IF EXISTS provider_status;
ALTER TABLE public.orders DROP COLUMN IF EXISTS refund_required, DROP COLUMN IF EXISTS refund_required_at, DROP COLUMN IF EXISTS refund_required_reason, DROP COLUMN IF EXISTS mercadopago_checkout_url, DROP COLUMN IF EXISTS mercadopago_preference_lease_token, DROP COLUMN IF EXISTS mercadopago_preference_lease_expires_at, DROP COLUMN IF EXISTS mercadopago_preference_attempts, DROP COLUMN IF EXISTS mercadopago_preference_last_error, DROP COLUMN IF EXISTS mercadopago_preference_reconciliation_required;

DELETE FROM public.settings
WHERE key = 'commerce_shipping' AND value = jsonb_build_object('fixed_amount', 0);

COMMIT;
