-- Manual rollback for ADMIN-01B admin boundary.
--
-- Restores direct authenticated writes on products/settings/product_images
-- and removes the narrow RPCs, matching the shape of migration
-- 202609110104_harden_commerce_privileges.sql and the baseline admin
-- policies. It deliberately does NOT drop public.admin_audit_events or any
-- row inside it: rolling back the write path must never erase history that
-- was already recorded. Local use only; never run against remote.

BEGIN;

DROP FUNCTION IF EXISTS "public"."admin_create_product"(text, text, text, numeric, text, boolean, integer, uuid);
DROP FUNCTION IF EXISTS "public"."admin_update_product"(uuid, text, text, text, numeric, text, boolean, integer, timestamptz, uuid);
DROP FUNCTION IF EXISTS "public"."admin_set_product_active"(uuid, boolean, timestamptz, uuid);
DROP FUNCTION IF EXISTS "public"."admin_upsert_settings_document"(text, jsonb, timestamptz, uuid);

DROP TRIGGER IF EXISTS "set_updated_at" ON "public"."settings";

GRANT INSERT, UPDATE, DELETE ON TABLE "public"."products" TO "authenticated";
GRANT INSERT, UPDATE, DELETE ON TABLE "public"."settings" TO "authenticated";
GRANT INSERT, UPDATE, DELETE ON TABLE "public"."product_images" TO "authenticated";

CREATE POLICY "admin insert products" ON "public"."products" FOR INSERT TO "authenticated" WITH CHECK (public.is_admin());
CREATE POLICY "admin update products" ON "public"."products" FOR UPDATE TO "authenticated" USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY "admin delete products" ON "public"."products" FOR DELETE TO "authenticated" USING (public.is_admin());

CREATE POLICY "admin insert settings" ON "public"."settings" FOR INSERT TO "authenticated" WITH CHECK (public.is_admin());
CREATE POLICY "admin update settings" ON "public"."settings" FOR UPDATE TO "authenticated" USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY "admin delete settings" ON "public"."settings" FOR DELETE TO "authenticated" USING (public.is_admin());

CREATE POLICY "admin insert product images" ON "public"."product_images" FOR INSERT TO "authenticated" WITH CHECK (public.is_admin());
CREATE POLICY "admin update product images" ON "public"."product_images" FOR UPDATE TO "authenticated" USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY "admin delete product images" ON "public"."product_images" FOR DELETE TO "authenticated" USING (public.is_admin());

-- admin_audit_events and its read policy/grant are intentionally left in
-- place: this table is additive and rolling back the write path must not
-- widen permissions or discard recorded history.

COMMIT;
