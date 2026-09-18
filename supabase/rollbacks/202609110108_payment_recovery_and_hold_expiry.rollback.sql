BEGIN;

-- Reverses 202609110108. Drops only what that migration created.
-- The column is dropped last and holds no commercial data: it records the
-- timestamp of the last provider recovery lookup for an order, nothing else.
-- No order, reservation, stock, payment or event row is touched.

DROP FUNCTION IF EXISTS public.expire_stale_commerce_holds(integer);
DROP FUNCTION IF EXISTS public.claim_payment_recovery_attempt(uuid, integer);

ALTER TABLE public.orders
  DROP COLUMN IF EXISTS payment_sync_last_attempt_at;

COMMIT;
