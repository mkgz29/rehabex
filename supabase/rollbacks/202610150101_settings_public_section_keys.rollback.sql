-- Manual rollback for FASE 7F-B1 settings public-key policy widening.
--
-- Restores "public read public settings" / "authenticated read public
-- settings" to exactly the 2-key allowlist they had before this migration
-- (hero_content, about_content only) -- the same literal USING clause as
-- supabase/migrations/202609110101_harden_existing_permissions.sql. Touches
-- no other policy, no grants, no RLS enable/force flag, no other table.
--
-- Safe even if 'featured_section_content'/'catalog_section_content' rows
-- already exist and are already public: rolling back only re-narrows who can
-- read them, it does not delete or alter the rows themselves. Local use
-- only; never run against remote without the same explicit review a forward
-- migration gets.

BEGIN;

ALTER POLICY "public read public settings"
ON "public"."settings"
USING ("key" = ANY (ARRAY['hero_content'::text, 'about_content'::text]));

ALTER POLICY "authenticated read public settings"
ON "public"."settings"
USING ("key" = ANY (ARRAY['hero_content'::text, 'about_content'::text]));

COMMIT;
