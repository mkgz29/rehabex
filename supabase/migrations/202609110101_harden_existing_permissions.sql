BEGIN;

CREATE OR REPLACE FUNCTION "public"."is_admin"()
RETURNS boolean
LANGUAGE "sql"
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles AS p
    WHERE p.id = auth.uid()
      AND p.role = 'admin'
  );
$$;

REVOKE ALL ON FUNCTION "public"."is_admin"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."is_admin"() FROM "anon";
REVOKE ALL ON FUNCTION "public"."is_admin"() FROM "authenticated";
GRANT EXECUTE ON FUNCTION "public"."is_admin"() TO "authenticated";
GRANT EXECUTE ON FUNCTION "public"."is_admin"() TO "service_role";

REVOKE ALL ON FUNCTION "public"."update_updated_at_column"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."update_updated_at_column"() FROM "anon";
REVOKE ALL ON FUNCTION "public"."update_updated_at_column"() FROM "authenticated";
GRANT EXECUTE ON FUNCTION "public"."update_updated_at_column"() TO "service_role";

-- Limit permission changes to the four baseline tables; do not disturb unknown objects.
REVOKE ALL ON TABLE "public"."products", "public"."settings", "public"."profiles", "public"."orders" FROM "anon";
REVOKE ALL ON TABLE "public"."products", "public"."settings", "public"."profiles", "public"."orders" FROM "authenticated";

GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";

GRANT SELECT ON TABLE "public"."products" TO "anon";
GRANT SELECT ON TABLE "public"."products" TO "authenticated";
GRANT INSERT, UPDATE, DELETE ON TABLE "public"."products" TO "authenticated";
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "public"."products" TO "service_role";

GRANT SELECT ON TABLE "public"."settings" TO "anon";
GRANT SELECT ON TABLE "public"."settings" TO "authenticated";
GRANT INSERT, UPDATE, DELETE ON TABLE "public"."settings" TO "authenticated";
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "public"."settings" TO "service_role";

GRANT SELECT ON TABLE "public"."profiles" TO "authenticated";
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "public"."profiles" TO "service_role";

GRANT SELECT ON TABLE "public"."orders" TO "authenticated";
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "public"."orders" TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."is_admin"() TO "authenticated";
GRANT EXECUTE ON FUNCTION "public"."is_admin"() TO "service_role";
GRANT EXECUTE ON FUNCTION "public"."update_updated_at_column"() TO "service_role";

-- These two policies are part of the verified SQL Editor baseline. Recreate only
-- them so the migration is repeatable without touching unrelated policies.
DROP POLICY IF EXISTS "public read public settings" ON "public"."settings";
DROP POLICY IF EXISTS "authenticated read public settings" ON "public"."settings";

CREATE POLICY "public read public settings"
ON "public"."settings"
FOR SELECT
TO "anon"
USING ("key" = ANY (ARRAY['hero_content'::text, 'about_content'::text]));

CREATE POLICY "authenticated read public settings"
ON "public"."settings"
FOR SELECT
TO "authenticated"
USING ("key" = ANY (ARRAY['hero_content'::text, 'about_content'::text]));

COMMIT;
