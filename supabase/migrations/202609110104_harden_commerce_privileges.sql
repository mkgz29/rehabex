BEGIN;

-- The captured production baseline grants broad default privileges to API roles.
-- Remove those inherited defaults so every future public object needs an explicit
-- grant in its own migration.
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public"
  REVOKE ALL ON TABLES FROM "anon", "authenticated", "service_role";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public"
  REVOKE ALL ON SEQUENCES FROM "anon", "authenticated", "service_role";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public"
  REVOKE ALL ON FUNCTIONS FROM "anon", "authenticated", "service_role";

-- Normalize table ACLs. RLS remains the row-level enforcement layer, while the
-- grants below define the maximum operation each API role may request.
REVOKE ALL ON TABLE
  "public"."profiles",
  "public"."products",
  "public"."orders",
  "public"."settings",
  "public"."product_images",
  "public"."order_items",
  "public"."stock_reservations",
  "public"."inventory_movements",
  "public"."payment_events"
FROM PUBLIC, "anon", "authenticated", "service_role";

GRANT SELECT ON TABLE "public"."products", "public"."settings", "public"."product_images" TO "anon";

GRANT SELECT ON TABLE
  "public"."profiles",
  "public"."products",
  "public"."orders",
  "public"."settings",
  "public"."product_images",
  "public"."order_items",
  "public"."stock_reservations",
  "public"."inventory_movements"
TO "authenticated";

GRANT INSERT, UPDATE, DELETE ON TABLE
  "public"."products",
  "public"."settings",
  "public"."product_images"
TO "authenticated";

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  "public"."profiles",
  "public"."products",
  "public"."orders",
  "public"."settings",
  "public"."product_images",
  "public"."order_items",
  "public"."stock_reservations",
  "public"."inventory_movements",
  "public"."payment_events"
TO "service_role";

-- The sequence is an implementation detail of next_order_number(). Clients must
-- neither inspect nor advance it directly.
REVOKE ALL ON SEQUENCE "public"."order_number_seq"
FROM PUBLIC, "anon", "authenticated", "service_role";
GRANT USAGE, SELECT ON SEQUENCE "public"."order_number_seq" TO "service_role";

-- Client-facing authorization helper. It is intentionally available only to an
-- authenticated caller and the trusted backend.
REVOKE ALL ON FUNCTION "public"."is_admin"()
FROM PUBLIC, "anon", "authenticated", "service_role";
GRANT EXECUTE ON FUNCTION "public"."is_admin"() TO "authenticated", "service_role";

-- Trigger functions are not public RPCs.
REVOKE ALL ON FUNCTION "public"."update_updated_at_column"()
FROM PUBLIC, "anon", "authenticated", "service_role";
GRANT EXECUTE ON FUNCTION "public"."update_updated_at_column"() TO "service_role";

REVOKE ALL ON FUNCTION "public"."handle_new_user"()
FROM PUBLIC, "anon", "authenticated", "service_role";
GRANT EXECUTE ON FUNCTION "public"."handle_new_user"() TO "service_role";

-- Checkout remains available to guests through the backend HTTP endpoint. These
-- SECURITY DEFINER functions accept backend-controlled values and therefore must
-- never be callable directly through the anon or authenticated PostgREST roles.
REVOKE ALL ON FUNCTION "public"."next_order_number"()
FROM PUBLIC, "anon", "authenticated", "service_role";
REVOKE ALL ON FUNCTION "public"."create_checkout_order"(
  uuid, text, uuid, text, text, text, "public"."delivery_method",
  jsonb, jsonb, text, numeric, numeric, integer
)
FROM PUBLIC, "anon", "authenticated", "service_role";
REVOKE ALL ON FUNCTION "public"."consume_order_reservation"(uuid, text)
FROM PUBLIC, "anon", "authenticated", "service_role";
REVOKE ALL ON FUNCTION "public"."release_order_reservation"(uuid, "public"."order_status")
FROM PUBLIC, "anon", "authenticated", "service_role";

GRANT EXECUTE ON FUNCTION "public"."next_order_number"() TO "service_role";
GRANT EXECUTE ON FUNCTION "public"."create_checkout_order"(
  uuid, text, uuid, text, text, text, "public"."delivery_method",
  jsonb, jsonb, text, numeric, numeric, integer
) TO "service_role";
GRANT EXECUTE ON FUNCTION "public"."consume_order_reservation"(uuid, text) TO "service_role";
GRANT EXECUTE ON FUNCTION "public"."release_order_reservation"(uuid, "public"."order_status") TO "service_role";

COMMIT;
