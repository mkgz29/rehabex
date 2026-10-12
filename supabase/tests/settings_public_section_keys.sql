\set ON_ERROR_STOP on

-- FASE 7F-B1: "public read public settings" / "authenticated read public
-- settings" must expose exactly 4 keys (hero_content, about_content,
-- featured_section_content, catalog_section_content) to anon and to a
-- non-admin authenticated user, and nothing else -- admin keeps seeing
-- everything via the separate "admin read settings" policy (is_admin()).

BEGIN;

CREATE TEMP TABLE settings_rls_results (
  test_name text PRIMARY KEY,
  ok boolean NOT NULL,
  detail text NOT NULL
);

-- Fixtures: one row per key already in the allowlist model, plus a private
-- key that must never be exposed publicly (same shape as a real internal
-- settings document, e.g. commerce_shipping).
INSERT INTO public.settings (key, value) VALUES
  ('hero_content', '{"title":"h"}'::jsonb),
  ('about_content', '{"title":"a"}'::jsonb),
  ('featured_section_content', '{"title":"f"}'::jsonb),
  ('catalog_section_content', '{"title":"c"}'::jsonb),
  ('commerce_shipping', '{"amount":500}'::jsonb)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;

DO $$
DECLARE
  v_admin_id uuid := gen_random_uuid();
  v_customer_id uuid := gen_random_uuid();
  v_keys text[];
BEGIN
  INSERT INTO auth.users (id, email) VALUES (v_admin_id, 'admin-' || v_admin_id || '@example.test'), (v_customer_id, 'customer-' || v_customer_id || '@example.test');
  INSERT INTO public.profiles (id, role) VALUES (v_admin_id, 'admin'), (v_customer_id, 'customer')
    ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role;

  -- 1. anon: exactly the 4 public keys, nothing else.
  SET ROLE anon;
  SELECT array_agg(key ORDER BY key) INTO v_keys FROM public.settings;
  RESET ROLE;
  IF v_keys IS DISTINCT FROM ARRAY['about_content','catalog_section_content','featured_section_content','hero_content'] THEN
    RAISE EXCEPTION 'anon saw the wrong key set: %', v_keys;
  END IF;
  INSERT INTO settings_rls_results VALUES ('anon sees exactly the 4 public keys', true, array_to_string(v_keys, ','));

  -- 2. anon: the private key is never visible, individually.
  SET ROLE anon;
  PERFORM 1 FROM public.settings WHERE key = 'commerce_shipping';
  IF FOUND THEN RESET ROLE; RAISE EXCEPTION 'anon could read commerce_shipping'; END IF;
  RESET ROLE;
  INSERT INTO settings_rls_results VALUES ('anon cannot read a non-allowlisted key (commerce_shipping)', true, 'not found, as expected');

  -- 3. authenticated non-admin: same 4 keys, same exclusion.
  PERFORM set_config('request.jwt.claim.sub', v_customer_id::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_customer_id, 'role', 'authenticated')::text, true);
  SET ROLE authenticated;
  SELECT array_agg(key ORDER BY key) INTO v_keys FROM public.settings;
  PERFORM 1 FROM public.settings WHERE key = 'commerce_shipping';
  IF FOUND THEN RESET ROLE; RAISE EXCEPTION 'authenticated non-admin could read commerce_shipping'; END IF;
  RESET ROLE;
  IF v_keys IS DISTINCT FROM ARRAY['about_content','catalog_section_content','featured_section_content','hero_content'] THEN
    RAISE EXCEPTION 'authenticated non-admin saw the wrong key set: %', v_keys;
  END IF;
  INSERT INTO settings_rls_results VALUES ('authenticated non-admin: same 4 public keys, same exclusion', true, array_to_string(v_keys, ','));

  -- 4. admin: still sees everything, unaffected by this migration (admin read
  --    settings has no key filter at all -- it predates and is independent
  --    of the two policies this migration touches).
  PERFORM set_config('request.jwt.claim.sub', v_admin_id::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin_id, 'role', 'authenticated')::text, true);
  SET ROLE authenticated;
  SELECT array_agg(key ORDER BY key) INTO v_keys FROM public.settings;
  RESET ROLE;
  IF NOT ('commerce_shipping' = ANY(v_keys)) OR array_length(v_keys, 1) < 5 THEN
    RAISE EXCEPTION 'admin lost visibility into non-public keys: %', v_keys;
  END IF;
  INSERT INTO settings_rls_results VALUES ('admin keeps full visibility (including the private key)', true, array_to_string(v_keys, ','));

  -- 5. RLS flags and policy count are unchanged by this migration.
  IF NOT (SELECT relrowsecurity AND relforcerowsecurity FROM pg_class WHERE oid = 'public.settings'::regclass) THEN
    RAISE EXCEPTION 'RLS enable/force regressed on settings';
  END IF;
  IF (SELECT count(*) FROM pg_policy WHERE polrelid = 'public.settings'::regclass) <> 6 THEN
    RAISE EXCEPTION 'policy count on settings changed unexpectedly (expected 6: 4 admin write/read + the 2 widened public ones)';
  END IF;
  INSERT INTO settings_rls_results VALUES ('RLS enable/force and policy count unchanged', true, 'migration only widened USING, nothing else');
END;
$$;

SELECT test_name, ok, detail FROM settings_rls_results ORDER BY test_name;

ROLLBACK;
