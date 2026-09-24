# ADMIN-01B — frontera administrativa y auditoría

ADMIN-01B reemplaza las escrituras directas del navegador sobre `products` y `settings` (Hero/About) por operaciones administrativas estrechas, autenticadas, validadas y auditadas. No agrega módulos de negocio nuevos: Productos, Hero y About son exactamente las mismas funciones que ya existían en el panel, movidas detrás de una frontera segura.

## Arquitectura

```text
Panel React
→ /api/admin/products/{create,update,set-active}
→ /api/admin/settings/{hero,about}
→ requireAdmin: método, origen, Content-Type, tamaño, JWT, rol en profiles
→ validador estricto por endpoint (server/admin/validators.ts)
→ RPC SECURITY DEFINER (auth.uid() + is_admin() + concurrencia + auditoría)
→ PostgreSQL (transacción única: cambio + auditoría)
→ respuesta sanitizada { producto|setting, requestId }
```

El JWT se valida contra Supabase Auth (`auth.getUser`) usando la service role sólo para esa verificación y la consulta de `profiles.role`. La mutación en sí se ejecuta con un cliente Supabase separado, autenticado con el propio token del usuario (`SUPABASE_ANON_KEY` + `Authorization: Bearer <token>`), para que `auth.uid()` resuelva dentro de las funciones `SECURITY DEFINER`. `service_role` nunca ejecuta la mutación.

## Helper administrativo compartido

`server/admin/requireAdmin.ts` centraliza el boundary para los cinco endpoints:

1. Método (`POST` únicamente).
2. Origen contra la allowlist existente (`applyAdminCors`).
3. `Content-Type: application/json`.
4. Tamaño de cuerpo (16 KiB).
5. `Authorization: Bearer <token>` presente y sin ambigüedad.
6. `auth.getUser(token)` — rechaza tokens de `service_role`.
7. `profiles.role = 'admin'`, consultado en cada request.
8. Devuelve únicamente `{ userId, requestId, body, rpc }`; nunca el token ni la sesión completa.

Respuestas: `401` (token ausente/invalido), `403` (autenticado sin rol admin), `405`, `413`, `415`; `422`/`409`/`404` se resuelven después, a partir de la validación de payload y de los códigos de error de la RPC (`server/admin/adminErrors.ts`).

## Validadores (`server/admin/validators.ts`)

Objetos cerrados: cualquier clave no listada rechaza con `422` (`unknown_field`). Nunca se hace spread del body hacia Supabase.

**Productos — permitido:** `name`, `description`, `category`, `price`, `imageUrl`, `isFeatured`, `displayOrder`; `update`/`set-active` agregan `id` y `expectedUpdatedAt`.

**Rechazado explícitamente:** `stock_on_hand`, `low_stock_threshold`, `reserved_stock`, `currency`, `created_at`, `updated_at` (como valor nuevo), `created_by`, `updated_by`, `role`, `is_active` (en create/update), `id` en create.

**Reglas:** nombre y categoría requeridos y acotados; categoría `TEST`/`PRUEBA` rechazada al crear (siempre) y al activar (según el estado real en base); precio finito, positivo, con máximo razonable (`NaN`/`Infinity`/negativos/strings rechazados); `imageUrl` vacío o HTTPS; `displayOrder` entero no negativo acotado.

**Hero/About:** sólo `hero_content`/`about_content`, nunca elegidos por el cliente (cada endpoint fija la key). Campos exactos y acotados, CTA interno (`/...`, `#...`) o HTTPS, imagen HTTPS obligatoria, métricas de About acotadas a 6 con `id` restringido a `[a-z0-9-]`, y cualquier texto con `<`/`>` rechazado.

## RPC administrativas (`202609230201_admin_01b_admin_boundary.sql`)

- `admin_create_product` — crea siempre inactivo; rechaza categoría reservada.
- `admin_update_product` — actualiza sólo los campos permitidos con concurrencia optimista; una categoría reservada sólo se rechaza si el producto está activo; sin cambios reales no genera auditoría ni toca `updated_at`.
- `admin_set_product_active` — activar exige nombre/precio/categoría válidos y categoría no reservada; desactivar es reversible y no valida nada adicional.
- `admin_upsert_settings_document` — sólo `hero_content`/`about_content`; distingue creación (`before_state = NULL`) de actualización; concurrencia optimista.

Todas: `SECURITY DEFINER`, `search_path = ''`, exigen `auth.uid()` y `public.is_admin()`, bloquean la fila (`FOR UPDATE`), comparan `updated_at` esperado, y auditan en la misma transacción antes de retornar. Un error revierte cambio y auditoría juntos (son la misma transacción).

Errores del dominio se comunican con `SQLSTATE` propios que `server/admin/adminErrors.ts` traduce a HTTP sin filtrar mensaje, hint ni stack de Postgres:

| SQLSTATE | Significado | HTTP |
|---|---|---|
| `ADM01` | sin `auth.uid()` | 401 |
| `ADM03` | no es admin | 403 |
| `ADM04` | registro inexistente | 404 |
| `ADM09` | conflicto de versión / duplicado | 409 |
| `ADM22` | payload o regla de negocio inválida | 422 |

**Grants:** `EXECUTE` sólo para `authenticated` (la función valida admin internamente); `anon` no tiene ejecución sobre ninguna RPC administrativa ni sobre `admin_audit_events`.

## Auditoría (`public.admin_audit_events`)

`id, actor_id, action, entity_type, entity_id, request_id, before_state, after_state, created_at`. Índice único en `request_id` (defensivo; cada request genera uno nuevo en `requireAdmin`, nunca lo elige el cliente). RLS forzada: sólo `SELECT` para `authenticated` filtrado por `is_admin()`; ninguna política ni grant de escritura existe para ningún rol — el único escritor es la propia RPC, que corre como dueño de la tabla (`postgres`) y por lo tanto no depende de esos grants.

Acciones: `product.created`, `product.updated`, `product.price_changed`, `product.activated`, `product.deactivated`, `hero.updated`, `about.updated`. Un cambio de precio genera `product.price_changed` (no un `product.updated` adicional) con el precio anterior y nuevo en `before_state`/`after_state`. No se auditan ediciones sin cambio efectivo ni escrituras rechazadas.

## Revocación de escrituras directas

La misma migración revoca `INSERT/UPDATE/DELETE` sobre `products`, `settings` y `product_images` para `authenticated` (incluye a los admins: ya no pueden mutar por PostgREST directo, sólo por las RPC) y elimina las políticas `admin insert/update/delete *` que dependían de esos grants. Las lecturas (`admin read all products`, `public read active products`, etc.) quedan intactas. `product_images` queda revisada aunque no se usa desde el frontend todavía.

## Eliminación física

No existe endpoint ni RPC de borrado de productos. El panel reemplazó "Eliminar" por "Activar"/"Desactivar" (`AdminProductsPage.tsx`), respaldado por `admin_set_product_active`.

## Panel (adaptación mínima)

`src/services/adminApi.ts` es el único punto del navegador que llama `/api/admin/*`; obtiene el `access_token` de la sesión de Supabase vigente y lo manda como `Authorization: Bearer`. `src/services/cms.ts` conserva únicamente lecturas (`getProducts`, `getActiveProducts`, `getProductById`, `getLandingContent`); `saveProduct`, `deleteProduct`, `saveHeroContent` y `saveAboutContent` se quitaron de ahí.

- `AdminProductsPage.tsx`: crear/editar van a `adminApi`; el botón "Eliminar" desapareció; cada fila tiene "Activar"/"Desactivar" con su propio `expectedUpdatedAt`; no hay UI optimista en precio ni en activo — el estado local sólo se actualiza con la respuesta confirmada del servidor.
- `AdminHeroPage.tsx` / `AdminAboutPage.tsx`: cargan el documento y su `updated_at` (`getSettingVersion`), lo envían como `expectedUpdatedAt`, y muestran el mensaje de conflicto exacto pedido en caso de `409` sin sobrescribir en silencio.
- Errores: `401`/`403`/`404`/`409`/`422` producen mensajes claros sin detalle interno del servidor; los campos del formulario se conservan tal cual los escribió el admin cuando el servidor rechaza la validación.

`ImageField` sigue deshabilitado (upload firmado queda para ADMIN-02/ADMIN-03); Stock nunca aparece editable.

## Pruebas

- **SQL/RLS local** (`supabase/tests/admin_01b_admin_boundary.sql`, transacción con `ROLLBACK`): 32/32 aserciones — anon/customer sin acceso directo ni a RPC ni a auditoría; admin sin DML directo; ciclo completo de creación/activación/edición/desactivación; categoría reservada rechazada al crear, al activar (fixture legado) y al editar activo; no-op sin auditoría; cambio de precio auditado con antes/después; conflicto de versión con `ADM09`; hero creación vs actualización; clave desconocida rechazada; RLS de auditoría forzada.
- **SQL/RLS ADMIN-01A actualizado** (`supabase/tests/admin_01a_public_catalog_safety.sql`): 26/26 — los cuatro casos que antes probaban que un admin *podía* mutar productos/settings directamente ahora prueban que **no puede** (superados por ADMIN-01B); el resto del archivo (visibilidad TEST/PRUEBA, roles, RLS) queda igual.
- **API contract** (`tests/admin/adminBoundary.contract.test.ts`, `tests/admin/adminValidators.test.ts`): 49/49 — límites (401/403/405/409/413/415/422), validación por campo, éxito con `requestId`, y que el token/la sesión nunca aparecen en una respuesta.
- **Concurrencia real** (`tests/db/adminBoundaryConcurrency.test.ts`, contra Supabase local, usuario admin sintético real): dos ediciones reales y sucesivas — la primera aplica, la segunda con la versión anterior recibe `ADM09`, el valor final es sólo el de la primera, y existe un único evento `product.price_changed`.
- **Smoke end-to-end** (script ad-hoc, no versionado): login real, crear → editar → forzar conflicto `409` → activar → desactivar; DML directo bloqueado con la sesión del propio admin; Hero/About con conflicto; categoría `TEST` y campo `stock_on_hand` rechazados con `422`; usuario normal rechazado con `403`. 16/16.
- **Regresión:** `test:admin:safety` (12/12), `test:api` (76/76), `test:cart` (13/13) sin cambios de resultado.

`test:db:concurrency` (comercial) no se ejecutó como parte de este cierre: ADMIN-01B no toca checkout, pagos ni inventario, y esa suite exige credenciales locales explícitas que no formaban parte de esta validación.

## Rollback

`supabase/rollbacks/202609230201_admin_01b_admin_boundary.rollback.sql` restaura los grants y políticas `admin insert/update/delete` anteriores sobre `products`/`settings`/`product_images` y elimina las cuatro RPC. Deliberadamente **no** elimina `admin_audit_events` ni ninguna fila ya auditada. Sólo para uso local; nunca contra remoto.

## Fuera de alcance (documentado para ADMIN-01C/ADMIN-02)

Upload firmado, `media_assets`, galería, estado editorial (`draft/published/archived`), slugs públicos, categorías como tabla, stock editable, nuevos roles, gestión de usuarios, checkout, pagos, envíos. Nada de esto se tocó.
