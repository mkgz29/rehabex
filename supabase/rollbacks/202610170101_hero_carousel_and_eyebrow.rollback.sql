-- Manual rollback for the Hero carousel + editable eyebrow phase.
--
-- Drops the RPC and the hero_images table entirely, including any slides
-- already saved through it. Does NOT touch settings.hero_content.eyebrow:
-- that was always just a plain jsonb key on an existing document (the
-- forward migration's own backfill UPDATE, not a schema change), so there
-- is nothing to drop -- an admin who already edited it keeps their text,
-- and the public page falls back to rendering nothing for that line once
-- the application code reading heroContent.eyebrow is also rolled back.
--
-- Local use only; never run against remote without the same explicit
-- review a forward migration gets.

BEGIN;

DROP FUNCTION IF EXISTS "public"."admin_sync_hero_images"(jsonb, uuid);

DROP TABLE IF EXISTS "public"."hero_images";

COMMIT;
