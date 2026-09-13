BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace WHERE n.nspname = 'public' AND t.typname = 'delivery_method') THEN
    CREATE TYPE "public"."delivery_method" AS ENUM ('pickup', 'delivery');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace WHERE n.nspname = 'public' AND t.typname = 'payment_status') THEN
    CREATE TYPE "public"."payment_status" AS ENUM ('unpaid', 'pending', 'approved', 'rejected', 'cancelled', 'refunded', 'charged_back');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace WHERE n.nspname = 'public' AND t.typname = 'fulfillment_status') THEN
    CREATE TYPE "public"."fulfillment_status" AS ENUM ('not_started', 'preparing', 'ready_for_pickup', 'shipped', 'delivered', 'cancelled', 'returned');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace WHERE n.nspname = 'public' AND t.typname = 'order_status') THEN
    CREATE TYPE "public"."order_status" AS ENUM ('draft', 'pending_payment', 'confirmed', 'on_hold', 'cancelled', 'completed', 'expired', 'refunded', 'failed');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace WHERE n.nspname = 'public' AND t.typname = 'reservation_status') THEN
    CREATE TYPE "public"."reservation_status" AS ENUM ('active', 'consumed', 'released', 'expired');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace WHERE n.nspname = 'public' AND t.typname = 'inventory_movement_type') THEN
    CREATE TYPE "public"."inventory_movement_type" AS ENUM ('initial', 'adjustment', 'sale', 'return', 'reservation_release_correction');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace WHERE n.nspname = 'public' AND t.typname = 'payment_event_status') THEN
    CREATE TYPE "public"."payment_event_status" AS ENUM ('received', 'ignored', 'processed', 'failed', 'duplicate', 'invalid_signature');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace WHERE n.nspname = 'public' AND t.typname = 'review_reason') THEN
    CREATE TYPE "public"."review_reason" AS ENUM ('late_approved_payment_no_stock', 'payment_amount_mismatch', 'payment_currency_mismatch', 'payment_reference_mismatch', 'manual_fulfillment_block', 'customer_request', 'provider_dispute', 'other');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace WHERE n.nspname = 'public' AND t.typname = 'review_resolution') THEN
    CREATE TYPE "public"."review_resolution" AS ENUM ('stock_acquired_confirmed', 'refunded_by_provider', 'cancelled_by_provider', 'fulfilled_manually', 'customer_accepted_alternative', 'marked_as_false_positive', 'other');
  END IF;
END
$$;

CREATE SEQUENCE IF NOT EXISTS "public"."order_number_seq";

CREATE OR REPLACE FUNCTION "public"."next_order_number"()
RETURNS text
LANGUAGE "plpgsql"
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  next_value bigint;
BEGIN
  next_value := nextval('public.order_number_seq'::regclass);
  RETURN 'RHB-' || to_char(now(), 'YYYYMM') || '-' || lpad(next_value::text, 6, '0');
END;
$$;

REVOKE ALL ON FUNCTION "public"."next_order_number"() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "public"."next_order_number"() TO "service_role";

ALTER TABLE "public"."orders"
  ADD COLUMN IF NOT EXISTS "order_number" text,
  ADD COLUMN IF NOT EXISTS "idempotency_key" uuid,
  ADD COLUMN IF NOT EXISTS "checkout_request_hash" text,
  ADD COLUMN IF NOT EXISTS "customer_email" text,
  ADD COLUMN IF NOT EXISTS "customer_name" text,
  ADD COLUMN IF NOT EXISTS "customer_phone" text,
  ADD COLUMN IF NOT EXISTS "delivery_method" "public"."delivery_method",
  ADD COLUMN IF NOT EXISTS "delivery_recipient_name" text,
  ADD COLUMN IF NOT EXISTS "delivery_phone" text,
  ADD COLUMN IF NOT EXISTS "delivery_address_line1" text,
  ADD COLUMN IF NOT EXISTS "delivery_address_line2" text,
  ADD COLUMN IF NOT EXISTS "delivery_city" text,
  ADD COLUMN IF NOT EXISTS "delivery_province" text,
  ADD COLUMN IF NOT EXISTS "delivery_postal_code" text,
  ADD COLUMN IF NOT EXISTS "delivery_notes" text,
  ADD COLUMN IF NOT EXISTS "pickup_location_label" text,
  ADD COLUMN IF NOT EXISTS "pickup_window" text,
  ADD COLUMN IF NOT EXISTS "subtotal_amount" numeric(12,2),
  ADD COLUMN IF NOT EXISTS "shipping_amount" numeric(12,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "discount_amount" numeric(12,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "total_amount" numeric(12,2),
  ADD COLUMN IF NOT EXISTS "payment_status" "public"."payment_status",
  ADD COLUMN IF NOT EXISTS "fulfillment_status" "public"."fulfillment_status",
  ADD COLUMN IF NOT EXISTS "order_status" "public"."order_status",
  ADD COLUMN IF NOT EXISTS "review_required" boolean DEFAULT false NOT NULL,
  ADD COLUMN IF NOT EXISTS "review_reason" "public"."review_reason",
  ADD COLUMN IF NOT EXISTS "review_resolved_at" timestamp with time zone,
  ADD COLUMN IF NOT EXISTS "review_resolved_by" uuid,
  ADD COLUMN IF NOT EXISTS "review_resolution" "public"."review_resolution",
  ADD COLUMN IF NOT EXISTS "mercadopago_preference_id" text,
  ADD COLUMN IF NOT EXISTS "mercadopago_payment_id" text,
  ADD COLUMN IF NOT EXISTS "status_access_token_hash" text,
  ADD COLUMN IF NOT EXISTS "reservation_expires_at" timestamp with time zone,
  ADD COLUMN IF NOT EXISTS "paid_at" timestamp with time zone,
  ADD COLUMN IF NOT EXISTS "cancellation_requested_at" timestamp with time zone,
  ADD COLUMN IF NOT EXISTS "cancellation_requested_by" uuid,
  ADD COLUMN IF NOT EXISTS "cancellation_reason" text,
  ADD COLUMN IF NOT EXISTS "refund_requested_at" timestamp with time zone,
  ADD COLUMN IF NOT EXISTS "refund_provider_reference" text,
  ADD COLUMN IF NOT EXISTS "cancelled_at" timestamp with time zone,
  ADD COLUMN IF NOT EXISTS "completed_at" timestamp with time zone;

UPDATE "public"."orders"
SET
  "customer_email" = COALESCE("customer_email", "payer_email"),
  "subtotal_amount" = COALESCE("subtotal_amount", "amount"),
  "shipping_amount" = COALESCE("shipping_amount", 0),
  "discount_amount" = COALESCE("discount_amount", 0),
  "total_amount" = COALESCE("total_amount", "amount"),
  "payment_status" = COALESCE(
    "payment_status",
    CASE "status"
      WHEN 'approved' THEN 'approved'::public.payment_status
      WHEN 'rejected' THEN 'rejected'::public.payment_status
      WHEN 'cancelled' THEN 'cancelled'::public.payment_status
      WHEN 'refunded' THEN 'refunded'::public.payment_status
      WHEN 'pending' THEN 'pending'::public.payment_status
      WHEN 'in_process' THEN 'pending'::public.payment_status
      ELSE 'unpaid'::public.payment_status
    END
  ),
  "fulfillment_status" = COALESCE("fulfillment_status", 'not_started'::public.fulfillment_status),
  "order_status" = COALESCE(
    "order_status",
    CASE "status"
      WHEN 'approved' THEN 'confirmed'::public.order_status
      WHEN 'rejected' THEN 'cancelled'::public.order_status
      WHEN 'cancelled' THEN 'cancelled'::public.order_status
      WHEN 'refunded' THEN 'refunded'::public.order_status
      WHEN 'pending' THEN 'pending_payment'::public.order_status
      WHEN 'in_process' THEN 'pending_payment'::public.order_status
      ELSE 'pending_payment'::public.order_status
    END
  ),
  "mercadopago_payment_id" = COALESCE("mercadopago_payment_id", "payment_id")
WHERE "payment_status" IS NULL
   OR "fulfillment_status" IS NULL
   OR "order_status" IS NULL
   OR "subtotal_amount" IS NULL
   OR "total_amount" IS NULL
   OR "customer_email" IS NULL
   OR "mercadopago_payment_id" IS NULL;

ALTER TABLE "public"."orders"
  ALTER COLUMN "shipping_amount" SET DEFAULT 0,
  ALTER COLUMN "discount_amount" SET DEFAULT 0,
  ALTER COLUMN "payment_status" SET DEFAULT 'unpaid',
  ALTER COLUMN "fulfillment_status" SET DEFAULT 'not_started',
  ALTER COLUMN "order_status" SET DEFAULT 'draft',
  ADD CONSTRAINT "orders_amount_nonnegative_check" CHECK ("amount" >= 0) NOT VALID,
  ADD CONSTRAINT "orders_currency_ars_check" CHECK ("currency" = 'ARS') NOT VALID,
  ADD CONSTRAINT "orders_subtotal_nonnegative_check" CHECK ("subtotal_amount" IS NULL OR "subtotal_amount" >= 0) NOT VALID,
  ADD CONSTRAINT "orders_shipping_nonnegative_check" CHECK ("shipping_amount" IS NULL OR "shipping_amount" >= 0) NOT VALID,
  ADD CONSTRAINT "orders_discount_nonnegative_check" CHECK ("discount_amount" IS NULL OR "discount_amount" >= 0) NOT VALID,
  ADD CONSTRAINT "orders_total_nonnegative_check" CHECK ("total_amount" IS NULL OR "total_amount" >= 0) NOT VALID,
  ADD CONSTRAINT "orders_total_amount_math_check" CHECK (
    "subtotal_amount" IS NULL
    OR "shipping_amount" IS NULL
    OR "discount_amount" IS NULL
    OR "total_amount" = "subtotal_amount" + "shipping_amount" - "discount_amount"
  ) NOT VALID,
  ADD CONSTRAINT "orders_review_reason_required_check" CHECK ("review_required" = false OR "review_reason" IS NOT NULL) NOT VALID,
  ADD CONSTRAINT "orders_review_resolution_consistency_check" CHECK (
    "review_resolved_at" IS NULL
    OR ("review_resolution" IS NOT NULL AND "review_resolved_by" IS NOT NULL)
  ) NOT VALID;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'orders_review_resolved_by_fkey'
      AND conrelid = 'public.orders'::regclass
  ) THEN
    ALTER TABLE "public"."orders"
      ADD CONSTRAINT "orders_review_resolved_by_fkey" FOREIGN KEY ("review_resolved_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'orders_cancellation_requested_by_fkey'
      AND conrelid = 'public.orders'::regclass
  ) THEN
    ALTER TABLE "public"."orders"
      ADD CONSTRAINT "orders_cancellation_requested_by_fkey" FOREIGN KEY ("cancellation_requested_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;
  END IF;
END
$$;

CREATE UNIQUE INDEX IF NOT EXISTS "idx_orders_order_number_unique" ON "public"."orders" ("order_number") WHERE "order_number" IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "idx_orders_idempotency_key_unique" ON "public"."orders" ("idempotency_key") WHERE "idempotency_key" IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "idx_orders_mercadopago_preference_unique" ON "public"."orders" ("mercadopago_preference_id") WHERE "mercadopago_preference_id" IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "idx_orders_mercadopago_payment_unique" ON "public"."orders" ("mercadopago_payment_id") WHERE "mercadopago_payment_id" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "idx_orders_order_status_created" ON "public"."orders" ("order_status", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "idx_orders_payment_status_created" ON "public"."orders" ("payment_status", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "idx_orders_fulfillment_status_created" ON "public"."orders" ("fulfillment_status", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "idx_orders_review_required_created" ON "public"."orders" ("created_at" DESC) WHERE "review_required" = true;
CREATE INDEX IF NOT EXISTS "idx_orders_reservation_expires" ON "public"."orders" ("reservation_expires_at") WHERE "order_status" = 'pending_payment';
CREATE INDEX IF NOT EXISTS "idx_orders_customer_email_created" ON "public"."orders" ("customer_email", "created_at" DESC);

CREATE TABLE IF NOT EXISTS "public"."product_images" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "product_id" uuid NOT NULL REFERENCES "public"."products"("id") ON DELETE CASCADE,
  "url" text NOT NULL,
  "alt_text" text,
  "display_order" integer DEFAULT 0 NOT NULL,
  "is_primary" boolean DEFAULT false NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "product_images_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "product_images_url_not_empty_check" CHECK (btrim("url") <> '')
);

CREATE UNIQUE INDEX IF NOT EXISTS "idx_product_images_order_unique" ON "public"."product_images" ("product_id", "display_order");
CREATE UNIQUE INDEX IF NOT EXISTS "idx_product_images_one_primary" ON "public"."product_images" ("product_id") WHERE "is_primary" = true;
CREATE INDEX IF NOT EXISTS "idx_product_images_product_order" ON "public"."product_images" ("product_id", "display_order");

CREATE TABLE IF NOT EXISTS "public"."order_items" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "order_id" uuid NOT NULL REFERENCES "public"."orders"("id") ON DELETE CASCADE,
  "product_id" uuid REFERENCES "public"."products"("id") ON DELETE SET NULL,
  "product_sku" text,
  "product_name" text NOT NULL,
  "product_image_url" text,
  "unit_price" numeric(12,2) NOT NULL,
  "currency" character(3) DEFAULT 'ARS' NOT NULL,
  "quantity" integer NOT NULL,
  "line_total" numeric(12,2) NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "order_items_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "order_items_product_name_not_empty_check" CHECK (btrim("product_name") <> ''),
  CONSTRAINT "order_items_unit_price_positive_check" CHECK ("unit_price" > 0),
  CONSTRAINT "order_items_currency_ars_check" CHECK ("currency" = 'ARS'),
  CONSTRAINT "order_items_quantity_positive_check" CHECK ("quantity" > 0),
  CONSTRAINT "order_items_line_total_math_check" CHECK ("line_total" = "unit_price" * "quantity")
);

CREATE UNIQUE INDEX IF NOT EXISTS "idx_order_items_order_product_unique" ON "public"."order_items" ("order_id", "product_id") WHERE "product_id" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "idx_order_items_order_id" ON "public"."order_items" ("order_id");
CREATE INDEX IF NOT EXISTS "idx_order_items_product_id" ON "public"."order_items" ("product_id");

CREATE TABLE IF NOT EXISTS "public"."stock_reservations" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "order_id" uuid NOT NULL REFERENCES "public"."orders"("id") ON DELETE CASCADE,
  "product_id" uuid NOT NULL REFERENCES "public"."products"("id") ON DELETE RESTRICT,
  "quantity" integer NOT NULL,
  "status" "public"."reservation_status" DEFAULT 'active' NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "consumed_at" timestamp with time zone,
  "released_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "stock_reservations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "stock_reservations_quantity_positive_check" CHECK ("quantity" > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS "idx_stock_reservations_order_product_unique" ON "public"."stock_reservations" ("order_id", "product_id");
CREATE INDEX IF NOT EXISTS "idx_stock_reservations_product_status_expires" ON "public"."stock_reservations" ("product_id", "status", "expires_at");
CREATE INDEX IF NOT EXISTS "idx_stock_reservations_active_expires" ON "public"."stock_reservations" ("expires_at") WHERE "status" = 'active';
CREATE INDEX IF NOT EXISTS "idx_stock_reservations_order_id" ON "public"."stock_reservations" ("order_id");

CREATE TABLE IF NOT EXISTS "public"."inventory_movements" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "product_id" uuid NOT NULL REFERENCES "public"."products"("id") ON DELETE RESTRICT,
  "order_id" uuid REFERENCES "public"."orders"("id") ON DELETE SET NULL,
  "reservation_id" uuid REFERENCES "public"."stock_reservations"("id") ON DELETE SET NULL,
  "movement_type" "public"."inventory_movement_type" NOT NULL,
  "quantity_delta" integer NOT NULL,
  "reason" text,
  "created_by" uuid REFERENCES "auth"."users"("id") ON DELETE SET NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "inventory_movements_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "inventory_movements_quantity_delta_nonzero_check" CHECK ("quantity_delta" <> 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS "idx_inventory_movements_sale_once" ON "public"."inventory_movements" ("order_id", "product_id", "movement_type") WHERE "movement_type" = 'sale';
CREATE INDEX IF NOT EXISTS "idx_inventory_movements_product_created" ON "public"."inventory_movements" ("product_id", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "idx_inventory_movements_order_id" ON "public"."inventory_movements" ("order_id");
CREATE INDEX IF NOT EXISTS "idx_inventory_movements_created_by" ON "public"."inventory_movements" ("created_by", "created_at" DESC);

CREATE TABLE IF NOT EXISTS "public"."payment_events" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "provider" text DEFAULT 'mercadopago' NOT NULL,
  "request_id" text,
  "event_type" text,
  "provider_event_id" text,
  "provider_payment_id" text,
  "order_id" uuid REFERENCES "public"."orders"("id") ON DELETE SET NULL,
  "external_reference" text,
  "signature_valid" boolean DEFAULT false NOT NULL,
  "signature_ts" timestamp with time zone,
  "payload_hash" text NOT NULL,
  "status" "public"."payment_event_status" DEFAULT 'received' NOT NULL,
  "error_code" text,
  "error_message" text,
  "raw_payload" jsonb,
  "processed_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "payment_events_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "payment_events_provider_not_empty_check" CHECK (btrim("provider") <> ''),
  CONSTRAINT "payment_events_payload_hash_not_empty_check" CHECK (btrim("payload_hash") <> '')
);

CREATE UNIQUE INDEX IF NOT EXISTS "idx_payment_events_provider_request_unique" ON "public"."payment_events" ("provider", "request_id") WHERE "request_id" IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "idx_payment_events_provider_event_unique" ON "public"."payment_events" ("provider", "provider_event_id") WHERE "provider_event_id" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "idx_payment_events_provider_payment_created" ON "public"."payment_events" ("provider_payment_id", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "idx_payment_events_order_created" ON "public"."payment_events" ("order_id", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "idx_payment_events_payload_hash" ON "public"."payment_events" ("payload_hash");

ALTER TABLE "public"."product_images" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."product_images" FORCE ROW LEVEL SECURITY;
ALTER TABLE "public"."order_items" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."order_items" FORCE ROW LEVEL SECURITY;
ALTER TABLE "public"."stock_reservations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."stock_reservations" FORCE ROW LEVEL SECURITY;
ALTER TABLE "public"."inventory_movements" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."inventory_movements" FORCE ROW LEVEL SECURITY;
ALTER TABLE "public"."payment_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."payment_events" FORCE ROW LEVEL SECURITY;

CREATE POLICY "public read active product images"
ON "public"."product_images"
FOR SELECT
TO "anon"
USING (EXISTS (
  SELECT 1 FROM public.products AS p
  WHERE p.id = product_images.product_id
    AND p.is_active = true
));

CREATE POLICY "authenticated read active product images"
ON "public"."product_images"
FOR SELECT
TO "authenticated"
USING (
  public.is_admin()
  OR EXISTS (
    SELECT 1 FROM public.products AS p
    WHERE p.id = product_images.product_id
      AND p.is_active = true
  )
);

CREATE POLICY "admin insert product images"
ON "public"."product_images"
FOR INSERT
TO "authenticated"
WITH CHECK (public.is_admin());

CREATE POLICY "admin update product images"
ON "public"."product_images"
FOR UPDATE
TO "authenticated"
USING (public.is_admin())
WITH CHECK (public.is_admin());

CREATE POLICY "admin delete product images"
ON "public"."product_images"
FOR DELETE
TO "authenticated"
USING (public.is_admin());

CREATE POLICY "users read own order items"
ON "public"."order_items"
FOR SELECT
TO "authenticated"
USING (
  public.is_admin()
  OR EXISTS (
    SELECT 1 FROM public.orders AS o
    WHERE o.id = order_items.order_id
      AND o.user_id = auth.uid()
  )
);

CREATE POLICY "admin read stock reservations"
ON "public"."stock_reservations"
FOR SELECT
TO "authenticated"
USING (public.is_admin());

CREATE POLICY "admin read inventory movements"
ON "public"."inventory_movements"
FOR SELECT
TO "authenticated"
USING (public.is_admin());

GRANT SELECT ON TABLE "public"."product_images" TO "anon";
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "public"."product_images" TO "authenticated";
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "public"."product_images" TO "service_role";

GRANT SELECT ON TABLE "public"."order_items" TO "authenticated";
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "public"."order_items" TO "service_role";

GRANT SELECT ON TABLE "public"."stock_reservations" TO "authenticated";
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "public"."stock_reservations" TO "service_role";

GRANT SELECT ON TABLE "public"."inventory_movements" TO "authenticated";
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "public"."inventory_movements" TO "service_role";

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "public"."payment_events" TO "service_role";
GRANT USAGE, SELECT ON SEQUENCE "public"."order_number_seq" TO "service_role";

CREATE OR REPLACE FUNCTION "public"."create_checkout_order"(
  p_idempotency_key uuid,
  p_checkout_request_hash text,
  p_user_id uuid,
  p_customer_email text,
  p_customer_name text,
  p_customer_phone text,
  p_delivery_method "public"."delivery_method",
  p_delivery_payload jsonb,
  p_items jsonb,
  p_status_access_token_hash text,
  p_shipping_amount numeric DEFAULT 0,
  p_discount_amount numeric DEFAULT 0,
  p_reservation_minutes integer DEFAULT 15
)
RETURNS TABLE (
  order_id uuid,
  order_number text,
  subtotal_amount numeric,
  shipping_amount numeric,
  discount_amount numeric,
  total_amount numeric,
  currency text,
  reservation_expires_at timestamp with time zone
)
LANGUAGE "plpgsql"
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_existing public.orders%ROWTYPE;
  v_order_id uuid;
  v_order_number text;
  v_reservation_expires_at timestamp with time zone;
  v_item jsonb;
  v_product_id uuid;
  v_quantity integer;
  v_product public.products%ROWTYPE;
  v_available integer;
  v_reserved integer;
  v_line_total numeric(12,2);
  v_subtotal numeric(12,2) := 0;
  v_total numeric(12,2);
BEGIN
  IF p_idempotency_key IS NULL THEN
    RAISE EXCEPTION 'idempotency key is required' USING ERRCODE = '22023';
  END IF;
  IF p_checkout_request_hash IS NULL OR btrim(p_checkout_request_hash) = '' THEN
    RAISE EXCEPTION 'checkout request hash is required' USING ERRCODE = '22023';
  END IF;
  IF p_customer_email IS NULL OR position('@' IN p_customer_email) <= 1 THEN
    RAISE EXCEPTION 'valid customer email is required' USING ERRCODE = '22023';
  END IF;
  IF p_customer_name IS NULL OR btrim(p_customer_name) = '' THEN
    RAISE EXCEPTION 'customer name is required' USING ERRCODE = '22023';
  END IF;
  IF p_status_access_token_hash IS NULL OR btrim(p_status_access_token_hash) = '' THEN
    RAISE EXCEPTION 'status access token hash is required' USING ERRCODE = '22023';
  END IF;
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'checkout items are required' USING ERRCODE = '22023';
  END IF;
  IF COALESCE(p_shipping_amount, 0) < 0 OR COALESCE(p_discount_amount, 0) < 0 THEN
    RAISE EXCEPTION 'amounts cannot be negative' USING ERRCODE = '22023';
  END IF;
  IF p_reservation_minutes IS NULL OR p_reservation_minutes <= 0 THEN
    RAISE EXCEPTION 'reservation minutes must be positive' USING ERRCODE = '22023';
  END IF;

  SELECT *
  INTO v_existing
  FROM public.orders AS o
  WHERE o.idempotency_key = p_idempotency_key
  FOR UPDATE;

  IF FOUND THEN
    IF v_existing.checkout_request_hash IS DISTINCT FROM p_checkout_request_hash THEN
      RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT' USING ERRCODE = '23505';
    END IF;

    RETURN QUERY
    SELECT
      v_existing.id,
      v_existing.order_number,
      v_existing.subtotal_amount,
      v_existing.shipping_amount,
      v_existing.discount_amount,
      v_existing.total_amount,
      v_existing.currency,
      v_existing.reservation_expires_at;
    RETURN;
  END IF;

  v_order_number := public.next_order_number();
  v_order_id := gen_random_uuid();
  v_reservation_expires_at := now() + make_interval(mins => p_reservation_minutes);

  INSERT INTO public.orders (
    "id",
    "order_number",
    "idempotency_key",
    "checkout_request_hash",
    "user_id",
    "external_reference",
    "status",
    "amount",
    "currency",
    "items",
    "customer_email",
    "customer_name",
    "customer_phone",
    "delivery_method",
    "delivery_recipient_name",
    "delivery_phone",
    "delivery_address_line1",
    "delivery_address_line2",
    "delivery_city",
    "delivery_province",
    "delivery_postal_code",
    "delivery_notes",
    "pickup_location_label",
    "pickup_window",
    "shipping_amount",
    "discount_amount",
    "payment_status",
    "fulfillment_status",
    "order_status",
    "status_access_token_hash",
    "reservation_expires_at"
  )
  VALUES (
    v_order_id,
    v_order_number,
    p_idempotency_key,
    p_checkout_request_hash,
    p_user_id,
    v_order_id::text,
    'pending',
    0,
    'ARS',
    '[]'::jsonb,
    btrim(p_customer_email),
    btrim(p_customer_name),
    NULLIF(btrim(COALESCE(p_customer_phone, '')), ''),
    p_delivery_method,
    NULLIF(btrim(COALESCE(p_delivery_payload->>'recipientName', p_delivery_payload->>'recipient_name', '')), ''),
    NULLIF(btrim(COALESCE(p_delivery_payload->>'phone', '')), ''),
    NULLIF(btrim(COALESCE(p_delivery_payload->>'addressLine1', p_delivery_payload->>'address_line1', '')), ''),
    NULLIF(btrim(COALESCE(p_delivery_payload->>'addressLine2', p_delivery_payload->>'address_line2', '')), ''),
    NULLIF(btrim(COALESCE(p_delivery_payload->>'city', '')), ''),
    NULLIF(btrim(COALESCE(p_delivery_payload->>'province', '')), ''),
    NULLIF(btrim(COALESCE(p_delivery_payload->>'postalCode', p_delivery_payload->>'postal_code', '')), ''),
    NULLIF(btrim(COALESCE(p_delivery_payload->>'notes', '')), ''),
    NULLIF(btrim(COALESCE(p_delivery_payload->>'pickupLocationLabel', p_delivery_payload->>'pickup_location_label', '')), ''),
    NULLIF(btrim(COALESCE(p_delivery_payload->>'pickupWindow', p_delivery_payload->>'pickup_window', '')), ''),
    COALESCE(p_shipping_amount, 0),
    COALESCE(p_discount_amount, 0),
    'unpaid',
    'not_started',
    'draft',
    p_status_access_token_hash,
    v_reservation_expires_at
  );

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items)
  LOOP
    v_product_id := NULLIF(COALESCE(v_item->>'product_id', v_item->>'productId', ''), '')::uuid;
    v_quantity := COALESCE((v_item->>'quantity')::integer, 0);

    IF v_product_id IS NULL OR v_quantity <= 0 THEN
      RAISE EXCEPTION 'invalid checkout item' USING ERRCODE = '22023';
    END IF;

    SELECT *
    INTO v_product
    FROM public.products AS p
    WHERE p.id = v_product_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'product not found: %', v_product_id USING ERRCODE = '22023';
    END IF;
    IF v_product.is_active IS DISTINCT FROM true THEN
      RAISE EXCEPTION 'product is inactive: %', v_product_id USING ERRCODE = '22023';
    END IF;
    IF v_product.price IS NULL OR v_product.price <= 0 THEN
      RAISE EXCEPTION 'product has invalid price: %', v_product_id USING ERRCODE = '22023';
    END IF;
    IF v_product.currency <> 'ARS' THEN
      RAISE EXCEPTION 'product has invalid currency: %', v_product_id USING ERRCODE = '22023';
    END IF;

    IF v_product.track_stock = true AND v_product.allow_backorder = false THEN
      SELECT COALESCE(sum(sr.quantity), 0)
      INTO v_reserved
      FROM public.stock_reservations AS sr
      WHERE sr.product_id = v_product_id
        AND sr.status = 'active'
        AND sr.expires_at > now();

      v_available := v_product.stock_on_hand - v_reserved;
      IF v_available < v_quantity THEN
        RAISE EXCEPTION 'STOCK_UNAVAILABLE' USING ERRCODE = 'P0001';
      END IF;
    END IF;

    v_line_total := round(v_product.price * v_quantity, 2);
    v_subtotal := v_subtotal + v_line_total;

    INSERT INTO public.order_items (
      "order_id",
      "product_id",
      "product_sku",
      "product_name",
      "product_image_url",
      "unit_price",
      "currency",
      "quantity",
      "line_total"
    )
    VALUES (
      v_order_id,
      v_product.id,
      v_product.sku,
      v_product.name,
      COALESCE(v_product.primary_image_url, v_product.image_url),
      v_product.price,
      v_product.currency,
      v_quantity,
      v_line_total
    );

    IF v_product.track_stock = true THEN
      INSERT INTO public.stock_reservations ("order_id", "product_id", "quantity", "expires_at")
      VALUES (v_order_id, v_product.id, v_quantity, v_reservation_expires_at);
    END IF;
  END LOOP;

  v_total := v_subtotal + COALESCE(p_shipping_amount, 0) - COALESCE(p_discount_amount, 0);
  IF v_total < 0 THEN
    RAISE EXCEPTION 'total amount cannot be negative' USING ERRCODE = '22023';
  END IF;

  UPDATE public.orders AS o
  SET
    "amount" = v_total,
    "subtotal_amount" = v_subtotal,
    "shipping_amount" = COALESCE(p_shipping_amount, 0),
    "discount_amount" = COALESCE(p_discount_amount, 0),
    "total_amount" = v_total,
    "items" = (
      SELECT jsonb_agg(
        jsonb_build_object(
          'title', oi.product_name,
          'quantity', oi.quantity,
          'unit_price', oi.unit_price,
          'product_id', oi.product_id
        )
        ORDER BY oi.created_at
      )
      FROM public.order_items AS oi
      WHERE oi.order_id = v_order_id
    ),
    "order_status" = 'pending_payment',
    "updated_at" = now()
  WHERE o.id = v_order_id;

  RETURN QUERY
  SELECT
    o.id,
    o.order_number,
    o.subtotal_amount,
    o.shipping_amount,
    o.discount_amount,
    o.total_amount,
    o.currency,
    o.reservation_expires_at
  FROM public.orders AS o
  WHERE o.id = v_order_id;

EXCEPTION
  WHEN OTHERS THEN
    -- The protected block is rolled back before this handler runs. In particular,
    -- the order inserted above no longer exists here; re-raise without a delete.
    RAISE;
END;
$$;

CREATE OR REPLACE FUNCTION "public"."consume_order_reservation"(
  p_order_id uuid,
  p_mercadopago_payment_id text DEFAULT NULL
)
RETURNS boolean
LANGUAGE "plpgsql"
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_order public.orders%ROWTYPE;
  v_item record;
  v_reservation public.stock_reservations%ROWTYPE;
  v_product public.products%ROWTYPE;
  v_reserved integer;
  v_available integer;
BEGIN
  SELECT *
  INTO v_order
  FROM public.orders AS o
  WHERE o.id = p_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'order not found: %', p_order_id USING ERRCODE = '22023';
  END IF;

  IF v_order.order_status = 'confirmed' AND v_order.payment_status = 'approved' THEN
    RETURN true;
  END IF;

  FOR v_item IN
    SELECT oi.*
    FROM public.order_items AS oi
    WHERE oi.order_id = p_order_id
      AND oi.product_id IS NOT NULL
    ORDER BY oi.created_at
  LOOP
    SELECT *
    INTO v_product
    FROM public.products AS p
    WHERE p.id = v_item.product_id
    FOR UPDATE;

    IF NOT FOUND OR v_product.track_stock IS DISTINCT FROM true THEN
      CONTINUE;
    END IF;

    SELECT *
    INTO v_reservation
    FROM public.stock_reservations AS sr
    WHERE sr.order_id = p_order_id
      AND sr.product_id = v_item.product_id
    FOR UPDATE;

    IF FOUND AND v_reservation.status = 'consumed' THEN
      CONTINUE;
    END IF;

    IF FOUND AND v_reservation.status = 'active' AND v_reservation.expires_at > now() THEN
      UPDATE public.stock_reservations
      SET "status" = 'consumed', "consumed_at" = now()
      WHERE "id" = v_reservation.id;
    ELSE
      IF FOUND AND v_reservation.status = 'active' THEN
        UPDATE public.stock_reservations
        SET "status" = 'expired', "released_at" = now()
        WHERE "id" = v_reservation.id;
      END IF;

      SELECT COALESCE(sum(sr.quantity), 0)
      INTO v_reserved
      FROM public.stock_reservations AS sr
      WHERE sr.product_id = v_item.product_id
        AND sr.status = 'active'
        AND sr.expires_at > now();

      v_available := v_product.stock_on_hand - v_reserved;
      IF v_product.allow_backorder = false AND v_available < v_item.quantity THEN
        UPDATE public.orders
        SET
          "payment_status" = 'approved',
          "order_status" = 'on_hold',
          "fulfillment_status" = 'not_started',
          "review_required" = true,
          "review_reason" = 'late_approved_payment_no_stock',
          "mercadopago_payment_id" = COALESCE(p_mercadopago_payment_id, "mercadopago_payment_id"),
          "paid_at" = COALESCE("paid_at", now()),
          "updated_at" = now()
        WHERE "id" = p_order_id;

        RETURN false;
      END IF;
    END IF;

    UPDATE public.products
    SET
      "stock_on_hand" = "stock_on_hand" - v_item.quantity,
      "updated_at" = now()
    WHERE "id" = v_item.product_id;

    INSERT INTO public.inventory_movements (
      "product_id",
      "order_id",
      "reservation_id",
      "movement_type",
      "quantity_delta",
      "reason"
    )
    VALUES (
      v_item.product_id,
      p_order_id,
      CASE WHEN FOUND THEN v_reservation.id ELSE NULL END,
      'sale',
      -v_item.quantity,
      'payment approved'
    )
    ON CONFLICT DO NOTHING;
  END LOOP;

  UPDATE public.orders
  SET
    "payment_status" = 'approved',
    "order_status" = 'confirmed',
    "fulfillment_status" = 'not_started',
    "mercadopago_payment_id" = COALESCE(p_mercadopago_payment_id, "mercadopago_payment_id"),
    "paid_at" = COALESCE("paid_at", now()),
    "updated_at" = now()
  WHERE "id" = p_order_id;

  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION "public"."release_order_reservation"(
  p_order_id uuid,
  p_next_order_status "public"."order_status" DEFAULT 'expired'
)
RETURNS void
LANGUAGE "plpgsql"
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF p_next_order_status NOT IN ('cancelled', 'expired', 'failed') THEN
    RAISE EXCEPTION 'invalid release order status: %', p_next_order_status USING ERRCODE = '22023';
  END IF;

  UPDATE public.stock_reservations
  SET
    "status" = CASE WHEN p_next_order_status = 'expired' THEN 'expired'::public.reservation_status ELSE 'released'::public.reservation_status END,
    "released_at" = now()
  WHERE "order_id" = p_order_id
    AND "status" = 'active';

  UPDATE public.orders
  SET
    "order_status" = p_next_order_status,
    "payment_status" = CASE
      WHEN p_next_order_status = 'cancelled' THEN 'cancelled'::public.payment_status
      ELSE "payment_status"
    END,
    "updated_at" = now()
  WHERE "id" = p_order_id
    AND COALESCE("payment_status", 'unpaid') <> 'approved';
END;
$$;

REVOKE ALL ON FUNCTION "public"."create_checkout_order"(uuid, text, uuid, text, text, text, "public"."delivery_method", jsonb, jsonb, text, numeric, numeric, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."consume_order_reservation"(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."release_order_reservation"(uuid, "public"."order_status") FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "public"."create_checkout_order"(uuid, text, uuid, text, text, text, "public"."delivery_method", jsonb, jsonb, text, numeric, numeric, integer) TO "service_role";
GRANT EXECUTE ON FUNCTION "public"."consume_order_reservation"(uuid, text) TO "service_role";
GRANT EXECUTE ON FUNCTION "public"."release_order_reservation"(uuid, "public"."order_status") TO "service_role";

COMMIT;
