BEGIN;

-- FASE 7F-B1, hallazgo P1-1 (auditoría 7F-A): ADMIN-02E (migration
-- 202609260101) agregó 'featured_section_content' y 'catalog_section_content'
-- como claves válidas que un admin puede guardar (admin_upsert_settings_document
-- las acepta desde entonces), pero nunca actualizó las dos policies de lectura
-- pública creadas en 202609110101_harden_existing_permissions.sql. El resultado:
-- un admin puede guardar esas dos secciones ("Productos destacados" /
-- "Consultas") sin ningún error, pero anon/authenticated-no-admin nunca las ven
-- -- la landing sigue mostrando el texto hardcodeado de siempre, en silencio.
--
-- Esta migration solo amplía el allowlist de 'key' en esas dos policies
-- existentes, de 2 a 4 valores. No toca RLS enable/force, no toca grants, no
-- toca la policy "admin read settings" (ya sin filtro de key, is_admin() ve
-- todo), no toca ninguna otra tabla ni función.

ALTER POLICY "public read public settings"
ON "public"."settings"
USING ("key" = ANY (ARRAY['hero_content'::text, 'about_content'::text, 'featured_section_content'::text, 'catalog_section_content'::text]));

ALTER POLICY "authenticated read public settings"
ON "public"."settings"
USING ("key" = ANY (ARRAY['hero_content'::text, 'about_content'::text, 'featured_section_content'::text, 'catalog_section_content'::text]));

COMMIT;
