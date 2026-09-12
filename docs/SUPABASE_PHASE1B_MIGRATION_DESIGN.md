# Supabase Phase 1B migration design - Rehabex

Fecha: 2026-09-11

Alcance: diseno de migraciones incrementales posteriores al baseline real `supabase/baseline/20260911_remote_public_schema.sql`. No se aplica nada en remoto en esta fase.

## Principios

- Las migraciones parten del schema real, no de un schema ideal desde cero.
- No se dropean ni recrean tablas existentes.
- Se conserva compatibilidad temporal con `products.image_url`, `orders.status`, `orders.items` y `profiles.role = 'user'`.
- Las columnas nuevas criticas se agregan de forma compatible con historico: nullable temporal, defaults seguros o backfill explicito.
- RLS queda habilitado y forzado en tablas existentes y nuevas.
- Los grants se vuelven explicitos; no se depende de default privileges amplios.
- Mutaciones comerciales criticas quedan reservadas a backend/service role/RPC, no al cliente anonimo.
- El baseline sigue siendo fotografia, no migracion productiva.

## Migraciones propuestas

### 1. `202609110101_harden_existing_permissions.sql`

Objetivo:

- Revocar `GRANT ALL` excesivo a `anon` y `authenticated`.
- Revocar default privileges amplios sobre futuros objetos.
- Reotorgar permisos minimos compatibles con las policies actuales.
- Endurecer `public.is_admin()` con `SECURITY DEFINER` y `search_path = ''`.
- Agregar lectura publica controlada de settings CMS publicos.

Riesgo:

- Medio/alto. Si una policy admin existente estuviera mal, revocar grants amplios puede revelar dependencias ocultas.

Compatibilidad:

- Mantiene lectura publica de productos activos.
- Mantiene CRUD admin directo de `products` y `settings`.
- Corrige la lectura publica de `settings` para `hero_content` y `about_content`.

### 2. `202609110102_profiles_products_foundation.sql`

Objetivo:

- Extender `profiles` con `email`, `full_name`, `phone`, `updated_at`.
- Mantener compatibilidad con `role = 'user'` y agregar `customer` como rol objetivo.
- Crear trigger local para perfil nuevo desde `auth.users`.
- Extender `products` con `sku`, `slug`, `currency`, `primary_image_url`, stock y auditoria.
- Agregar constraints economicas y de inventario no destructivas.
- Agregar indices de catalogo.

Riesgo:

- Medio. Incluye backfills seguros para defaults y puede requerir revision de datos antes de validar constraints en produccion.

Compatibilidad:

- No elimina columnas actuales.
- No cambia el contrato frontend `imageUrl`.
- No exige todavia galeria ni variantes.

### 3. `202609110103_orders_commerce_foundation.sql`

Objetivo:

- Crear enums de comercio.
- Agregar campos nuevos a `orders` para idempotencia, snapshots, entrega, estados separados, review y token hash.
- Mantener `orders.status` y `orders.items` como compatibilidad temporal.
- Crear `product_images`, `order_items`, `stock_reservations`, `inventory_movements`, `payment_events`.
- Crear `next_order_number()`, `create_checkout_order()`, `consume_order_reservation()` y `release_order_reservation()`.
- Aplicar RLS/grants explicitos a tablas nuevas.

Riesgo:

- Alto. Introduce la base comercial principal y debe probarse localmente con baseline antes de staging.

Compatibilidad:

- No rompe `api/orders.ts` ni `OrdersTable` porque `orders.status` e `items` permanecen.
- El checkout viejo puede seguir existiendo hasta reemplazarlo por backend nuevo.
- La nueva RPC queda disponible para el backend futuro, no para uso directo del cliente.

## Pruebas locales requeridas

- Aplicar baseline real en una base Supabase local aislada.
- Aplicar las migraciones en orden.
- Verificar que no se apliquen contra `--linked`.
- Confirmar tablas, columnas, enums, funciones, triggers, RLS y policies.
- Confirmar que `anon` no escribe `products`, `settings`, `orders` ni `profiles`.
- Confirmar que `anon` lee productos activos y settings publicos permitidos.
- Confirmar que authenticated customer no lee ordenes ajenas ni modifica `profiles.role`.
- Confirmar que admin puede leer y mutar `products/settings`.
- Confirmar que `create_checkout_order()` crea orden, items, reserva y totales en una transaccion local.
- Confirmar que `consume_order_reservation()` descuenta stock una sola vez.
- Confirmar que `release_order_reservation()` libera reservas pendientes.

## Estrategia de staging antes de produccion

1. Crear un proyecto Supabase staging o una preview branch dedicada desde `rehabex-cms`.
2. Restaurar estructura y datos anonimizados/minimos suficientes para cubrir catalogo, settings, usuarios admin/customer y ordenes historicas.
3. Aplicar las migraciones en staging con CLI, nunca primero en produccion.
4. Ejecutar pruebas RLS con anon/auth/customer/admin y service role.
5. Ejecutar pruebas de checkout/webhook contra Mercado Pago sandbox o mocks.
6. Tomar nuevo dump de staging post-migracion y comparar contra el objetivo.
7. Preparar rollback incremental por migracion y ventana de mantenimiento.
8. Solo despues de staging OK, planificar aplicacion controlada en produccion.
