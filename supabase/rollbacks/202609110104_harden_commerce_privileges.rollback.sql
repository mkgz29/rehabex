BEGIN;

-- Restore the default ACLs captured before migration 202609110104.
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public"
  GRANT ALL ON TABLES TO "anon", "authenticated", "service_role";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public"
  GRANT ALL ON SEQUENCES TO "anon", "authenticated", "service_role";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public"
  GRANT ALL ON FUNCTIONS TO "anon", "authenticated", "service_role";

-- Migration 202609110103 inherited ALL on its five new tables for every API
-- role. Restore that exact pre-hardening state for an emergency rollback.
GRANT ALL ON TABLE
  "public"."product_images",
  "public"."order_items",
  "public"."stock_reservations",
  "public"."inventory_movements",
  "public"."payment_events"
TO "anon", "authenticated", "service_role";

-- The four original baseline tables already had narrow anon/authenticated ACLs,
-- while service_role inherited ALL.
GRANT ALL ON TABLE
  "public"."profiles",
  "public"."products",
  "public"."orders",
  "public"."settings"
TO "service_role";

GRANT ALL ON SEQUENCE "public"."order_number_seq"
TO "anon", "authenticated", "service_role";

GRANT EXECUTE ON FUNCTION "public"."next_order_number"()
TO "anon", "authenticated", "service_role";
GRANT EXECUTE ON FUNCTION "public"."create_checkout_order"(
  uuid, text, uuid, text, text, text, "public"."delivery_method",
  jsonb, jsonb, text, numeric, numeric, integer
) TO "anon", "authenticated", "service_role";
GRANT EXECUTE ON FUNCTION "public"."consume_order_reservation"(uuid, text)
TO "anon", "authenticated", "service_role";
GRANT EXECUTE ON FUNCTION "public"."release_order_reservation"(uuid, "public"."order_status")
TO "anon", "authenticated", "service_role";

COMMIT;
