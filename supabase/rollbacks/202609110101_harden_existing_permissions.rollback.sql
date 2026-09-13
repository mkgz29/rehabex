-- Manual rollback for 202609110101. Do not run automatically.
-- Restores the verified baseline policies and grants for the four baseline tables.
BEGIN;

DROP POLICY IF EXISTS "public read public settings" ON "public"."settings";
DROP POLICY IF EXISTS "authenticated read public settings" ON "public"."settings";
CREATE POLICY "public read public settings" ON "public"."settings" FOR SELECT TO "anon"
  USING ("key" = ANY (ARRAY['hero_content'::text, 'about_content'::text]));
CREATE POLICY "authenticated read public settings" ON "public"."settings" FOR SELECT TO "authenticated"
  USING ("key" = ANY (ARRAY['hero_content'::text, 'about_content'::text]));

GRANT ALL ON FUNCTION "public"."is_admin"() TO "anon", "authenticated", "service_role";
GRANT ALL ON FUNCTION "public"."update_updated_at_column"() TO "anon", "authenticated", "service_role";
GRANT ALL ON TABLE "public"."orders", "public"."products", "public"."profiles", "public"."settings" TO "anon", "authenticated", "service_role";
COMMIT;
