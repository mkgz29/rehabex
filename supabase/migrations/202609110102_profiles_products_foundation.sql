BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'public'
      AND t.typname = 'profile_role'
  ) THEN
    CREATE TYPE "public"."profile_role" AS ENUM ('admin', 'customer');
  END IF;
END
$$;

ALTER TABLE "public"."profiles"
  ADD COLUMN IF NOT EXISTS "email" text,
  ADD COLUMN IF NOT EXISTS "full_name" text,
  ADD COLUMN IF NOT EXISTS "phone" text,
  ADD COLUMN IF NOT EXISTS "updated_at" timestamp with time zone DEFAULT now() NOT NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'profiles_role_check'
      AND conrelid = 'public.profiles'::regclass
  ) THEN
    ALTER TABLE "public"."profiles" DROP CONSTRAINT "profiles_role_check";
  END IF;
END
$$;

ALTER TABLE "public"."profiles"
  ALTER COLUMN "role" SET DEFAULT 'customer',
  ADD CONSTRAINT "profiles_role_check" CHECK ("role" = ANY (ARRAY['admin'::text, 'user'::text, 'customer'::text]));

ALTER TABLE "public"."profiles"
  ADD CONSTRAINT "profiles_email_format_check"
  CHECK ("email" IS NULL OR position('@' IN "email") > 1) NOT VALID;

CREATE INDEX IF NOT EXISTS "idx_profiles_role" ON "public"."profiles" USING btree ("role");

DROP TRIGGER IF EXISTS "set_updated_at" ON "public"."profiles";
CREATE TRIGGER "set_updated_at"
BEFORE UPDATE ON "public"."profiles"
FOR EACH ROW
EXECUTE FUNCTION "public"."update_updated_at_column"();

CREATE OR REPLACE FUNCTION "public"."handle_new_user"()
RETURNS trigger
LANGUAGE "plpgsql"
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.profiles ("id", "email", "role")
  VALUES (NEW.id, NEW.email, 'customer')
  ON CONFLICT ("id") DO UPDATE
  SET "email" = COALESCE(public.profiles.email, EXCLUDED.email);

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION "public"."handle_new_user"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."handle_new_user"() FROM "anon";
REVOKE ALL ON FUNCTION "public"."handle_new_user"() FROM "authenticated";
GRANT EXECUTE ON FUNCTION "public"."handle_new_user"() TO "service_role";

DROP TRIGGER IF EXISTS "on_auth_user_created" ON "auth"."users";
CREATE TRIGGER "on_auth_user_created"
AFTER INSERT ON "auth"."users"
FOR EACH ROW
EXECUTE FUNCTION "public"."handle_new_user"();

ALTER TABLE "public"."products"
  ADD COLUMN IF NOT EXISTS "sku" text,
  ADD COLUMN IF NOT EXISTS "slug" text,
  ADD COLUMN IF NOT EXISTS "currency" character(3) DEFAULT 'ARS' NOT NULL,
  ADD COLUMN IF NOT EXISTS "primary_image_url" text,
  ADD COLUMN IF NOT EXISTS "track_stock" boolean DEFAULT true NOT NULL,
  ADD COLUMN IF NOT EXISTS "allow_backorder" boolean DEFAULT false NOT NULL,
  ADD COLUMN IF NOT EXISTS "stock_on_hand" integer DEFAULT 0 NOT NULL,
  ADD COLUMN IF NOT EXISTS "low_stock_threshold" integer DEFAULT 0 NOT NULL,
  ADD COLUMN IF NOT EXISTS "updated_at" timestamp with time zone DEFAULT now() NOT NULL;

UPDATE "public"."products"
SET
  "description" = COALESCE("description", ''),
  "is_featured" = COALESCE("is_featured", false),
  "display_order" = COALESCE("display_order", 0),
  "is_active" = COALESCE("is_active", true),
  "created_at" = COALESCE("created_at", now()),
  "primary_image_url" = COALESCE("primary_image_url", "image_url")
WHERE "description" IS NULL
   OR "is_featured" IS NULL
   OR "display_order" IS NULL
   OR "is_active" IS NULL
   OR "created_at" IS NULL
   OR ("primary_image_url" IS NULL AND "image_url" IS NOT NULL);

ALTER TABLE "public"."products"
  ALTER COLUMN "description" SET DEFAULT '',
  ALTER COLUMN "description" SET NOT NULL,
  ALTER COLUMN "is_featured" SET NOT NULL,
  ALTER COLUMN "display_order" SET NOT NULL,
  ALTER COLUMN "is_active" SET NOT NULL,
  ALTER COLUMN "created_at" SET NOT NULL;

ALTER TABLE "public"."products"
  ADD CONSTRAINT "products_price_positive_check" CHECK ("price" > 0) NOT VALID,
  ADD CONSTRAINT "products_currency_ars_check" CHECK ("currency" = 'ARS') NOT VALID,
  ADD CONSTRAINT "products_stock_on_hand_nonnegative_check" CHECK ("stock_on_hand" >= 0) NOT VALID,
  ADD CONSTRAINT "products_low_stock_threshold_nonnegative_check" CHECK ("low_stock_threshold" >= 0) NOT VALID;

CREATE UNIQUE INDEX IF NOT EXISTS "idx_products_sku_unique" ON "public"."products" ("sku") WHERE "sku" IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "idx_products_slug_unique" ON "public"."products" ("slug") WHERE "slug" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "idx_products_active_order_created" ON "public"."products" ("is_active", "display_order", "created_at" DESC) WHERE "is_active" = true;
CREATE INDEX IF NOT EXISTS "idx_products_category_active" ON "public"."products" ("category") WHERE "is_active" = true;
CREATE INDEX IF NOT EXISTS "idx_products_featured_order" ON "public"."products" ("is_featured", "display_order") WHERE "is_active" = true;

DROP TRIGGER IF EXISTS "set_updated_at" ON "public"."products";
CREATE TRIGGER "set_updated_at"
BEFORE UPDATE ON "public"."products"
FOR EACH ROW
EXECUTE FUNCTION "public"."update_updated_at_column"();

COMMIT;
