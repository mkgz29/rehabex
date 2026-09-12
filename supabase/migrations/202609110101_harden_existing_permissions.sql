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

REVOKE ALL ON ALL TABLES IN SCHEMA "public" FROM "anon";
REVOKE ALL ON ALL TABLES IN SCHEMA "public" FROM "authenticated";
REVOKE ALL ON ALL SEQUENCES IN SCHEMA "public" FROM "anon";
REVOKE ALL ON ALL SEQUENCES IN SCHEMA "public" FROM "authenticated";
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA "public" FROM "anon";
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA "public" FROM "authenticated";

ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" REVOKE ALL ON TABLES FROM "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" REVOKE ALL ON TABLES FROM "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" REVOKE ALL ON SEQUENCES FROM "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" REVOKE ALL ON SEQUENCES FROM "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" REVOKE ALL ON FUNCTIONS FROM "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" REVOKE ALL ON FUNCTIONS FROM "authenticated";

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
