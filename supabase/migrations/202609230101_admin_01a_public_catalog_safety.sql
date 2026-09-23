BEGIN;

-- Temporary ADMIN-01A safety rule. ADMIN-02 replaces category-based visibility
-- with an explicit editorial status. Admins retain their separate read-all policy.
DROP POLICY IF EXISTS "public read active products" ON "public"."products";
CREATE POLICY "public read active products"
ON "public"."products"
FOR SELECT
TO "anon"
USING (
  "is_active" = true
  AND lower(btrim(COALESCE("category", ''))) <> ALL (ARRAY['test'::text, 'prueba'::text])
);

DROP POLICY IF EXISTS "authenticated read active products" ON "public"."products";
CREATE POLICY "authenticated read active products"
ON "public"."products"
FOR SELECT
TO "authenticated"
USING (
  "is_active" = true
  AND lower(btrim(COALESCE("category", ''))) <> ALL (ARRAY['test'::text, 'prueba'::text])
);

DROP POLICY IF EXISTS "public read active product images" ON "public"."product_images";
CREATE POLICY "public read active product images"
ON "public"."product_images"
FOR SELECT
TO "anon"
USING (EXISTS (
  SELECT 1
  FROM public.products AS p
  WHERE p.id = product_images.product_id
    AND p.is_active = true
    AND lower(btrim(COALESCE(p.category, ''))) <> ALL (ARRAY['test'::text, 'prueba'::text])
));

DROP POLICY IF EXISTS "authenticated read active product images" ON "public"."product_images";
CREATE POLICY "authenticated read active product images"
ON "public"."product_images"
FOR SELECT
TO "authenticated"
USING (
  public.is_admin()
  OR EXISTS (
    SELECT 1
    FROM public.products AS p
    WHERE p.id = product_images.product_id
      AND p.is_active = true
      AND lower(btrim(COALESCE(p.category, ''))) <> ALL (ARRAY['test'::text, 'prueba'::text])
  )
);

COMMIT;
