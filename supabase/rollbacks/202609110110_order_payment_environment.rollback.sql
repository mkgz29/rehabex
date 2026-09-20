BEGIN;

-- Reverses 202609110110. Restores the pre-110 behaviour, in which the atomic
-- RPC accepted only live_mode = false regardless of the order.
--
-- WARNING: that behaviour is correct only while Rehabex is testing. After a
-- production switch it rejects every real payment. Roll back only to undo a
-- failed deployment, never as a way to run in production.

DROP TRIGGER IF EXISTS "orders_freeze_payment_environment" ON public.orders;
DROP FUNCTION IF EXISTS public.freeze_order_payment_environment();
DROP INDEX IF EXISTS public.idx_orders_payment_environment;

ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS "orders_payment_environment_check";

-- The column is dropped last. It holds no commercial data: only the string
-- 'test' or 'production' recording which Mercado Pago environment the order was
-- created under. No order, reservation, stock, payment or event row is touched.
ALTER TABLE public.orders DROP COLUMN IF EXISTS payment_environment;

-- The function body is restored by re-applying migration 202609110109, whose
-- environment check is the hardcoded `p_live_mode IS DISTINCT FROM false`.

COMMIT;
