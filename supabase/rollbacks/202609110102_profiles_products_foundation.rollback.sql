-- Manual rollback for 202609110102. Do not run automatically.
-- Stop if new columns contain business data; dropping them would lose data.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM public.profiles WHERE email IS NOT NULL OR full_name IS NOT NULL OR phone IS NOT NULL)
     OR EXISTS (SELECT 1 FROM public.products WHERE sku IS NOT NULL OR slug IS NOT NULL OR stock_on_hand <> 0) THEN
    RAISE EXCEPTION 'rollback would discard profile or product data';
  END IF;
END $$;

BEGIN;
DROP TRIGGER IF EXISTS "on_auth_user_created" ON auth.users;
DROP FUNCTION IF EXISTS "public"."handle_new_user"();
DROP TRIGGER IF EXISTS "set_updated_at" ON "public"."profiles";
DROP TRIGGER IF EXISTS "set_updated_at" ON "public"."products";
DROP INDEX IF EXISTS "public"."idx_profiles_role", "public"."idx_products_sku_unique", "public"."idx_products_slug_unique", "public"."idx_products_active_order_created", "public"."idx_products_category_active", "public"."idx_products_featured_order";
ALTER TABLE "public"."profiles" DROP CONSTRAINT IF EXISTS "profiles_email_format_check";
ALTER TABLE "public"."profiles" DROP CONSTRAINT IF EXISTS "profiles_role_check";
ALTER TABLE "public"."profiles" ADD CONSTRAINT "profiles_role_check" CHECK ("role" = ANY (ARRAY['admin'::text, 'user'::text]));
ALTER TABLE "public"."profiles" ALTER COLUMN "role" SET DEFAULT 'user';
ALTER TABLE "public"."products" DROP CONSTRAINT IF EXISTS "products_price_positive_check", DROP CONSTRAINT IF EXISTS "products_currency_ars_check", DROP CONSTRAINT IF EXISTS "products_stock_on_hand_nonnegative_check", DROP CONSTRAINT IF EXISTS "products_low_stock_threshold_nonnegative_check";
ALTER TABLE "public"."products" ALTER COLUMN "description" DROP DEFAULT, ALTER COLUMN "description" DROP NOT NULL, ALTER COLUMN "is_featured" DROP NOT NULL, ALTER COLUMN "display_order" DROP NOT NULL, ALTER COLUMN "is_active" DROP NOT NULL, ALTER COLUMN "created_at" DROP NOT NULL;
ALTER TABLE "public"."profiles" DROP COLUMN IF EXISTS "email", DROP COLUMN IF EXISTS "full_name", DROP COLUMN IF EXISTS "phone", DROP COLUMN IF EXISTS "updated_at";
ALTER TABLE "public"."products" DROP COLUMN IF EXISTS "sku", DROP COLUMN IF EXISTS "slug", DROP COLUMN IF EXISTS "currency", DROP COLUMN IF EXISTS "primary_image_url", DROP COLUMN IF EXISTS "track_stock", DROP COLUMN IF EXISTS "allow_backorder", DROP COLUMN IF EXISTS "stock_on_hand", DROP COLUMN IF EXISTS "low_stock_threshold", DROP COLUMN IF EXISTS "updated_at";
DROP TYPE IF EXISTS "public"."profile_role";
COMMIT;
