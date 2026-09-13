-- Manual rollback for 202609110103. Do not run automatically.
-- Any commerce row or populated order field requires backup-based review first.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM public.product_images) OR EXISTS (SELECT 1 FROM public.order_items)
     OR EXISTS (SELECT 1 FROM public.stock_reservations) OR EXISTS (SELECT 1 FROM public.inventory_movements)
     OR EXISTS (SELECT 1 FROM public.payment_events) THEN
    RAISE EXCEPTION 'rollback would discard commerce data';
  END IF;
  IF EXISTS (SELECT 1 FROM public.orders WHERE order_number IS NOT NULL OR idempotency_key IS NOT NULL OR payment_status IS NOT NULL) THEN
    RAISE EXCEPTION 'rollback would discard enriched order data';
  END IF;
END $$;

BEGIN;
DROP FUNCTION IF EXISTS "public"."release_order_reservation"("uuid", "public"."order_status");
DROP FUNCTION IF EXISTS "public"."consume_order_reservation"("uuid", text);
DROP FUNCTION IF EXISTS "public"."create_checkout_order"(uuid, text, uuid, text, text, text, "public"."delivery_method", jsonb, jsonb, text, numeric, numeric, integer);
DROP FUNCTION IF EXISTS "public"."next_order_number"();
DROP TABLE IF EXISTS "public"."payment_events", "public"."inventory_movements", "public"."stock_reservations", "public"."order_items", "public"."product_images";
DROP INDEX IF EXISTS "public"."idx_orders_order_number_unique", "public"."idx_orders_idempotency_key_unique", "public"."idx_orders_mercadopago_preference_unique", "public"."idx_orders_mercadopago_payment_unique", "public"."idx_orders_order_status_created", "public"."idx_orders_payment_status_created", "public"."idx_orders_fulfillment_status_created", "public"."idx_orders_review_required_created", "public"."idx_orders_reservation_expires", "public"."idx_orders_customer_email_created";
ALTER TABLE "public"."orders" DROP CONSTRAINT IF EXISTS "orders_review_resolved_by_fkey", DROP CONSTRAINT IF EXISTS "orders_cancellation_requested_by_fkey", DROP CONSTRAINT IF EXISTS "orders_amount_nonnegative_check", DROP CONSTRAINT IF EXISTS "orders_currency_ars_check", DROP CONSTRAINT IF EXISTS "orders_subtotal_nonnegative_check", DROP CONSTRAINT IF EXISTS "orders_shipping_nonnegative_check", DROP CONSTRAINT IF EXISTS "orders_discount_nonnegative_check", DROP CONSTRAINT IF EXISTS "orders_total_nonnegative_check", DROP CONSTRAINT IF EXISTS "orders_total_amount_math_check", DROP CONSTRAINT IF EXISTS "orders_review_reason_required_check", DROP CONSTRAINT IF EXISTS "orders_review_resolution_consistency_check";
ALTER TABLE "public"."orders" DROP COLUMN IF EXISTS "order_number", DROP COLUMN IF EXISTS "idempotency_key", DROP COLUMN IF EXISTS "checkout_request_hash", DROP COLUMN IF EXISTS "customer_email", DROP COLUMN IF EXISTS "customer_name", DROP COLUMN IF EXISTS "customer_phone", DROP COLUMN IF EXISTS "delivery_method", DROP COLUMN IF EXISTS "delivery_recipient_name", DROP COLUMN IF EXISTS "delivery_phone", DROP COLUMN IF EXISTS "delivery_address_line1", DROP COLUMN IF EXISTS "delivery_address_line2", DROP COLUMN IF EXISTS "delivery_city", DROP COLUMN IF EXISTS "delivery_province", DROP COLUMN IF EXISTS "delivery_postal_code", DROP COLUMN IF EXISTS "delivery_notes", DROP COLUMN IF EXISTS "pickup_location_label", DROP COLUMN IF EXISTS "pickup_window", DROP COLUMN IF EXISTS "subtotal_amount", DROP COLUMN IF EXISTS "shipping_amount", DROP COLUMN IF EXISTS "discount_amount", DROP COLUMN IF EXISTS "total_amount", DROP COLUMN IF EXISTS "payment_status", DROP COLUMN IF EXISTS "fulfillment_status", DROP COLUMN IF EXISTS "order_status", DROP COLUMN IF EXISTS "review_required", DROP COLUMN IF EXISTS "review_reason", DROP COLUMN IF EXISTS "review_resolved_at", DROP COLUMN IF EXISTS "review_resolved_by", DROP COLUMN IF EXISTS "review_resolution", DROP COLUMN IF EXISTS "mercadopago_preference_id", DROP COLUMN IF EXISTS "mercadopago_payment_id", DROP COLUMN IF EXISTS "status_access_token_hash", DROP COLUMN IF EXISTS "reservation_expires_at", DROP COLUMN IF EXISTS "paid_at", DROP COLUMN IF EXISTS "cancellation_requested_at", DROP COLUMN IF EXISTS "cancellation_requested_by", DROP COLUMN IF EXISTS "cancellation_reason", DROP COLUMN IF EXISTS "refund_requested_at", DROP COLUMN IF EXISTS "refund_provider_reference", DROP COLUMN IF EXISTS "cancelled_at", DROP COLUMN IF EXISTS "completed_at";
DROP SEQUENCE IF EXISTS "public"."order_number_seq";
-- Review populated orders before manually removing the added order columns.
DROP TYPE IF EXISTS "public"."review_resolution", "public"."review_reason", "public"."payment_event_status", "public"."inventory_movement_type", "public"."reservation_status", "public"."order_status", "public"."fulfillment_status", "public"."payment_status", "public"."delivery_method";
COMMIT;
