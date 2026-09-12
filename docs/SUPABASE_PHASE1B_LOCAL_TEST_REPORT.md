# Supabase Phase 1B local test report - Rehabex

Fecha: 2026-09-11

Alcance: implementacion y prueba local de migraciones incrementales de Fase 1B. No se aplicaron migraciones ni SQL en el proyecto remoto.

## Migraciones implementadas

| Archivo | Proposito |
| --- | --- |
| `supabase/migrations/202609110101_harden_existing_permissions.sql` | Endurece grants/default privileges, reotorga permisos minimos, endurece `is_admin()` y habilita lectura publica limitada de settings CMS. |
| `supabase/migrations/202609110102_profiles_products_foundation.sql` | Extiende `profiles` y `products`, agrega trigger de perfil, columnas de inventario, constraints e indices de catalogo. |
| `supabase/migrations/202609110103_orders_commerce_foundation.sql` | Agrega enums, columnas comerciales de `orders`, tablas nuevas, RLS/grants y RPCs de checkout/reserva. |

## Metodo de prueba local

1. Se creo un proyecto Supabase temporal aislado fuera del repo, con puertos locales alternativos para no interferir con otros proyectos.
2. Se inicio una DB local con Supabase CLI.
3. Se cargo el baseline real `supabase/baseline/20260911_remote_public_schema.sql` usando `psql` dentro del contenedor local.
4. Se aplicaron manualmente las tres migraciones en orden usando `psql` local.
5. Se ejecuto `supabase/tests/phase1b_local_smoke.sql`, que abre una transaccion, crea datos de prueba locales y termina con `ROLLBACK`.
6. Se ejecuto `npx supabase db lint --local` contra la DB local migrada.

## Resultados

| Verificacion | Resultado |
| --- | --- |
| Baseline aplicado localmente | OK |
| Migracion `202609110101` | OK |
| Migracion `202609110102` | OK |
| Migracion `202609110103` | OK |
| Smoke test local | OK, 16 aserciones |
| DB lint local | OK, sin errores |
| `git diff --check` | OK |

Smoke test cubierto:

- `anon` lee productos activos.
- `anon` lee solo settings publicos (`hero_content`, `about_content`).
- `anon` no inserta productos.
- `anon` no lee ordenes.
- Customer lee orden propia.
- Customer no lee orden ajena.
- Customer no modifica `profiles.role`.
- Admin actualiza `products`.
- Admin actualiza `settings`.
- `create_checkout_order()` crea orden, item y reserva.
- `consume_order_reservation()` descuenta stock una vez.
- `consume_order_reservation()` es idempotente.
- `release_order_reservation()` expira reserva.
- Checkout rechaza stock insuficiente.

Inventario local post-migracion:

- Tablas `public`: 9.
- Policies `public`: 25.
- Tablas con RLS enabled + forced: 9.
- Funciones `public`: 7.

## Observaciones tecnicas

- Las migraciones son incrementales respecto del baseline, por eso no deben ejecutarse sobre una DB vacia sin cargar primero el baseline o sin un baseline convertido deliberadamente para entornos nuevos.
- `orders.status` y `orders.items` se mantienen para compatibilidad con el admin actual.
- Las nuevas columnas obligatorias para el flujo futuro se agregan con compatibilidad para historico; algunas quedan nullable temporalmente hasta que una fase posterior complete backfill y validacion en staging.
- Las constraints economicas principales se agregan como `NOT VALID` cuando pueden encontrar datos historicos desconocidos.
- Los RPCs de checkout/reserva quedan otorgados solo a `service_role`.

## No realizado

- No se ejecuto `supabase db push`.
- No se ejecuto `supabase db reset --linked`.
- No se ejecuto `supabase migration up` remoto.
- No se consultaron ni modificaron datos remotos.
- No se implemento backend/frontend contra las nuevas RPCs.

## Estrategia de staging antes de produccion

Recomendacion: no aplicar estas migraciones directo en produccion. Primero crear una de estas opciones:

1. Proyecto staging dedicado de Supabase, recomendado si se necesita validar con Mercado Pago sandbox y variables separadas.
2. Preview branch de Supabase si el plan/organizacion lo soporta y se quiere comparar contra `main` con menor friccion.

Plan de staging:

1. Crear staging desde el schema actual o restaurar un dump seguro.
2. Cargar datos minimos o anonimizados: un admin, un customer, productos activos/inactivos, settings publicos/privados y ordenes historicas representativas.
3. Aplicar las tres migraciones en orden.
4. Ejecutar `supabase/tests/phase1b_local_smoke.sql` adaptado a staging sin datos sensibles.
5. Ejecutar pruebas manuales/API para anon, customer, admin y service role.
6. Validar frontend actual contra staging, especialmente landing/settings, admin productos y admin ordenes.
7. Probar checkout/webhook nuevos solo cuando Fase 2/3 existan, con Mercado Pago sandbox.
8. Generar dump post-migracion de staging y revisar diff.
9. Preparar rollback por migracion y ventana de mantenimiento.
10. Recién con staging aprobado, planificar produccion.

## Proximo paso

Revisar el SQL de Fase 1B como equipo, decidir si staging sera proyecto separado o preview branch, y ejecutar una prueba de staging completa antes de cualquier operacion sobre `rehabex-cms` produccion.
