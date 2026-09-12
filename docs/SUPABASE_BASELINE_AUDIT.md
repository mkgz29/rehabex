# Supabase baseline audit - Rehabex

Fecha de ejecucion: 2026-09-11
Proyecto remoto verificado por CLI: `rehabex-cms`
Rama/entorno: la CLI confirma el proyecto principal por nombre exacto y no lista preview branches. La etiqueta dashboard `PRODUCTION` no se expone en la salida usada por la CLI.
Alcance: Fase 1A, recuperacion y auditoria local del baseline real del schema remoto `public`, sin datos.

## Metodo utilizado

Se siguio un flujo conservador por tratarse de produccion:

1. Se leyeron completamente `docs/AUDIT_REHABEX_2026-09.md`, `docs/COMMERCE_HARDENING_PLAN.md` y este documento previo.
2. Se inspecciono Git y el estado local del repo.
3. Se verifico Supabase CLI con `npx supabase --version`: `2.117.0`.
4. Se valido la sesion con `npx supabase projects list --output json`.
5. Se encontro un proyecto llamado exactamente `rehabex-cms`.
6. Se comprobo que `supabase/.temp/project-ref` no existia antes de vincular.
7. Se vinculo el repo con `npx supabase link --project-ref <oculto>`.
8. Se creo `supabase/baseline/`.
9. Se ejecuto el dump oficial de schema:
   `npx supabase db dump --linked --schema public --file supabase/baseline/20260911_remote_public_schema.sql`.
10. Se audito localmente el SQL generado.

Notas operativas:

- El primer intento de `db dump` fallo porque Docker Desktop no estaba activo.
- Se inicio Docker Desktop localmente y se reintento el mismo flujo oficial.
- No se uso SQL Editor ni se ejecuto SQL manual remoto.
- No se leyo ni imprimio `.env`.
- No se documenta el project ref completo, credenciales, tokens, URLs privadas ni connection strings.

## Confirmacion de no escrituras remotas

No se ejecutaron migraciones, seeds, `db push`, `db reset`, `migration up`, `migration repair`, SQL remoto manual, ni operaciones DDL/DML sobre tablas remotas. No se consultaron filas ni datos de clientes, usuarios, productos u ordenes.

Los unicos comandos con contacto remoto fueron de verificacion/listado, `supabase link` y `supabase db dump` de solo schema. La CLI mostro `Initialising login role...` como parte del flujo oficial de dump; no hubo escrituras de datos ni cambios de schema `public` realizados por esta auditoria.

## Estado local

| Chequeo | Resultado |
| --- | --- |
| Rama Git | `main` |
| Estado inicial | `package.json`, `package-lock.json`, `docs/` y `supabase/` con cambios locales previos |
| `package.json` | Existe |
| `package-lock.json` | Existe |
| Supabase CLI dev dependency | Si, `supabase ^2.117.0` |
| `supabase/config.toml` | Existe |
| Vinculo previo | No existia antes de `link` |
| Vinculo final | Creado localmente en `supabase/.temp/project-ref` |
| `supabase/baseline/` | Creado |
| Baseline | `supabase/baseline/20260911_remote_public_schema.sql` |
| Tamano baseline | 9.567 bytes |
| Datos en baseline | No se detectaron `COPY`, `INSERT INTO`, `\copy` ni cargas de filas |

## Inventario del schema `public`

### Schemas

- `public`

### Extensiones relevantes

- No aparecen `CREATE EXTENSION` en el dump limitado a `public`.
- El schema usa `gen_random_uuid()`, por lo que la funcion existe en la base, pero la extension que la provee no queda inventariada por este dump de schema `public`.

### Enums y tipos personalizados

- No hay enums ni tipos personalizados.
- Roles y estados se modelan como `text` con `CHECK`.

### Tablas

#### `profiles`

Columnas:

| Columna | Tipo | Default | Null |
| --- | --- | --- | --- |
| `id` | `uuid` | none | not null |
| `role` | `text` | `'user'` | not null |
| `created_at` | `timestamptz` | `now()` | not null |

Constraints:

- PK: `profiles_pkey (id)`.
- FK: `profiles_id_fkey (id) references auth.users(id) on delete cascade`.
- CHECK: `role in ('admin', 'user')`.

Indices:

- PK only.

RLS:

- Enabled and forced.
- Policies:
  - `admin read all profiles`: `authenticated`, `SELECT`, `USING public.is_admin()`.
  - `users read own profile`: `authenticated`, `SELECT`, `USING id = auth.uid()`.

Observaciones:

- No hay policy de `INSERT`, `UPDATE` o `DELETE`.
- Un usuario normal no puede modificar `profiles.role` directamente desde PostgREST segun este baseline.
- No hay trigger visible para crear perfil al registrarse un usuario nuevo.
- El plan objetivo espera `profile_role`, rol default `customer`, `email`, `full_name`, `phone` y `updated_at`; no existen.

#### `products`

Columnas:

| Columna | Tipo | Default | Null |
| --- | --- | --- | --- |
| `id` | `uuid` | `gen_random_uuid()` | not null |
| `name` | `text` | none | not null |
| `description` | `text` | none | nullable |
| `category` | `text` | none | nullable |
| `price` | `numeric` | none | not null |
| `image_url` | `text` | none | nullable |
| `is_featured` | `boolean` | `false` | nullable |
| `display_order` | `integer` | `0` | nullable |
| `is_active` | `boolean` | `true` | nullable |
| `created_at` | `timestamptz` | `now()` | nullable |

Constraints:

- PK: `products_pkey (id)`.

Indices:

- PK only.

RLS:

- Enabled and forced.
- Policies:
  - `public read active products`: `anon`, `SELECT`, `USING is_active = true`.
  - `authenticated read active products`: `authenticated`, `SELECT`, `USING is_active = true`.
  - `admin read all products`: `authenticated`, `SELECT`, `USING public.is_admin()`.
  - `admin insert products`: `authenticated`, `INSERT`, `WITH CHECK public.is_admin()`.
  - `admin update products`: `authenticated`, `UPDATE`, `USING public.is_admin()`, `WITH CHECK public.is_admin()`.
  - `admin delete products`: `authenticated`, `DELETE`, `USING public.is_admin()`.

Observaciones:

- No hay escritura publica efectiva por RLS.
- Los grants son amplios, pero RLS limita mutaciones a admins.
- Faltan constraints de precio positivo, moneda, stock, SKU, slug, imagen principal obligatoria y `updated_at`.
- El codigo actual espera estas columnas y es compatible con el modelo basico actual.

#### `settings`

Columnas:

| Columna | Tipo | Default | Null |
| --- | --- | --- | --- |
| `key` | `text` | none | not null |
| `value` | `jsonb` | `{}` | not null |
| `updated_at` | `timestamptz` | `now()` | not null |

Constraints:

- PK: `settings_pkey (key)`.

Indices:

- PK only.

RLS:

- Enabled and forced.
- Policies:
  - `admin read settings`: `authenticated`, `SELECT`, `USING public.is_admin()`.
  - `admin insert settings`: `authenticated`, `INSERT`, `WITH CHECK public.is_admin()`.
  - `admin update settings`: `authenticated`, `UPDATE`, `USING public.is_admin()`, `WITH CHECK public.is_admin()`.
  - `admin delete settings`: `authenticated`, `DELETE`, `USING public.is_admin()`.

Observaciones:

- `anon` no puede leer `settings`.
- Usuarios autenticados no admin tampoco pueden leer `settings`.
- El frontend publico llama `supabase.from('settings').select('key, value')`; con este baseline esa consulta falla para visitantes.
- No hay policy de lectura publica para settings publicos ni separacion entre settings publicos y privados.

#### `orders`

Columnas:

| Columna | Tipo | Default | Null |
| --- | --- | --- | --- |
| `id` | `uuid` | `gen_random_uuid()` | not null |
| `user_id` | `uuid` | none | nullable |
| `external_reference` | `text` | none | nullable |
| `payment_id` | `text` | none | nullable |
| `preference_id` | `text` | none | nullable |
| `merchant_order_id` | `text` | none | nullable |
| `status` | `text` | none | not null |
| `amount` | `numeric` | none | not null |
| `currency` | `text` | `'ARS'` | nullable |
| `payment_method_id` | `text` | none | nullable |
| `payment_type_id` | `text` | none | nullable |
| `payer_email` | `text` | none | nullable |
| `payer_id` | `text` | none | nullable |
| `items` | `jsonb` | none | not null |
| `metadata` | `jsonb` | none | nullable |
| `created_at` | `timestamptz` | `now()` | nullable |
| `updated_at` | `timestamptz` | `now()` | nullable |

Constraints:

- PK: `orders_pkey (id)`.
- UNIQUE: `orders_external_reference_key (external_reference)`.
- UNIQUE: `orders_payment_id_key (payment_id)`.
- FK: `orders_user_id_fkey (user_id) references public.profiles(id) on delete set null`.
- CHECK: `status in ('pending', 'approved', 'rejected', 'cancelled', 'refunded', 'in_process')`.

Indices:

- `idx_orders_created_at (created_at)`.
- `idx_orders_payment_id (payment_id)`.
- `idx_orders_status (status)`.
- `idx_orders_user_id (user_id)`.

Triggers:

- `set_updated_at` before update, executes `public.update_updated_at_column()`.

RLS:

- Enabled and forced.
- Policies:
  - `admin read orders`: `authenticated`, `SELECT`, `USING public.is_admin()`.
  - `user read own orders`: `authenticated`, `SELECT`, `USING user_id = auth.uid()`.
  - `allow insert orders`: `service_role`, `INSERT`, `WITH CHECK true`.

Observaciones:

- `anon` no puede leer ni modificar ordenes por RLS.
- Un customer autenticado solo puede leer ordenes donde `user_id = auth.uid()`.
- Admin solo tiene lectura directa via RLS; las mutaciones operativas quedan para `service_role`.
- El modelo no crea orden interna previa al pago, no separa estados de pago/fulfillment/orden, no modela items normalizados, stock, reservas ni payment events.
- Faltan constraints de importes positivos, moneda `ARS`, totales, idempotencia y hashes/tokens de estado.

### Vistas

- No hay vistas en el dump.

### Secuencias

- No hay secuencias en el dump.

### Funciones

#### `public.is_admin()`

- Lenguaje: SQL.
- Volatilidad: `STABLE`.
- Seguridad: `SECURITY DEFINER`.
- `search_path`: `SET search_path TO 'public'`.
- Logica: devuelve true si existe `profiles.id = auth.uid()` con `role = 'admin'`.
- Grants:
  - `REVOKE ALL FROM PUBLIC`.
  - `GRANT ALL` a `anon`, `authenticated`, `service_role`.

Observaciones:

- Tiene `search_path` configurado, pero no usa el patron mas estricto `SET search_path = ''` con nombres totalmente calificados.
- Al ser `SECURITY DEFINER`, conviene endurecerlo y limitar grants a ejecucion necesaria.

#### `public.update_updated_at_column()`

- Lenguaje: PL/pgSQL.
- Seguridad: invoker por defecto.
- `search_path`: no definido.
- Uso: trigger de `orders.updated_at`.
- Grants: `GRANT ALL` a `anon`, `authenticated`, `service_role`.

Observaciones:

- No es `SECURITY DEFINER`, por lo que el riesgo de `search_path` es menor.
- El grant a roles cliente es innecesariamente amplio.

### Grants y default privileges

Grants actuales:

- `USAGE` en schema `public` para `postgres`, `anon`, `authenticated`, `service_role`.
- `GRANT ALL` en tablas `orders`, `products`, `profiles`, `settings` para `anon`, `authenticated`, `service_role`.
- `GRANT ALL` en funciones `is_admin` y `update_updated_at_column` para `anon`, `authenticated`, `service_role`.
- Default privileges de `postgres` en `public` conceden `ALL` sobre futuras sequences, functions y tables a `anon`, `authenticated` y `service_role`.

Riesgo:

- RLS mitiga el acceso efectivo actual, pero los grants y default privileges son excesivos.
- Si una tabla nueva se crea sin RLS o una policy queda permisiva, `anon` y `authenticated` heredarian demasiados permisos.

## Auditoria de acceso y RLS

### Preguntas concretas

| Pregunta | Resultado desde baseline |
| --- | --- |
| Usuarios normales pueden modificar `profiles.role` | No se observa policy de update/insert en `profiles`; no permitido directamente por RLS. |
| `anon` puede leer o modificar `orders` | No hay policy para `anon`; no permitido directamente por RLS. |
| Auth customer puede leer ordenes ajenas | No, salvo que sea admin; la policy customer exige `user_id = auth.uid()`. |
| `products` permite escritura publica | No efectiva por RLS; solo admin authenticated tiene insert/update/delete. |
| `settings` permite escritura publica | No efectiva por RLS; solo admin authenticated tiene insert/update/delete. |
| Policies con `USING true` o `WITH CHECK true` | Si: `allow insert orders` para `service_role` usa `WITH CHECK true`. |
| `SECURITY DEFINER` sin `search_path` seguro | No hay funcion SD sin `search_path`; `is_admin` usa `public`, recomendable endurecer a patron mas estricto. |
| Grants excesivos para `anon`/`authenticated` | Si, `GRANT ALL` en tablas/funciones y default privileges amplios. |
| Tablas sensibles sin RLS | No; las 4 tablas tienen RLS enabled y force. |
| Falta constraints sobre precios, estados o importes | Si; faltan checks de precio/amount/totales/moneda y estados separados. |

### Matriz de acceso real

La matriz se basa solo en schema, grants y policies del baseline. `admin` significa usuario `authenticated` para el cual `public.is_admin()` devuelve true. `service-role` se reporta como acceso operativo porque en Supabase normalmente bypasses RLS y ademas tiene grants amplios.

| Objeto | anon | authenticated/customer | admin | service-role |
| --- | --- | --- | --- | --- |
| `profiles` | Sin lectura/escritura efectiva por RLS | Lee perfil propio; no escritura | Lee todos; no escritura directa verificada | Acceso operativo |
| `products` | Lee productos activos; no escritura | Lee productos activos; no escritura | Lee todos; insert/update/delete | Acceso operativo |
| `settings` | Sin lectura/escritura efectiva por RLS | Sin lectura/escritura efectiva por RLS | Lee; insert/update/delete | Acceso operativo |
| `orders` | Sin lectura/escritura efectiva por RLS | Lee ordenes propias por `user_id`; no escritura | Lee todas; no escritura directa verificada | Acceso operativo |

## Riesgos por severidad

### Critica

1. Grants y default privileges excesivos para `anon` y `authenticated`.
   - Estado real: `GRANT ALL` en tablas y funciones; default privileges conceden `ALL` sobre objetos futuros.
   - Riesgo: una tabla futura sin RLS o una policy demasiado abierta expondria escritura/lectura amplia.
   - Recomendacion: migracion incremental para revocar privilegios no necesarios y conceder solo operaciones requeridas.

2. Modelo de ordenes insuficiente para e-commerce productivo.
   - Estado real: una tabla `orders` plana, creada por webhook/upsert, sin `order_items`, reserva, idempotencia, token de estado ni estados separados.
   - Riesgo: no hay trazabilidad confiable de checkout, stock, conciliacion o cumplimiento.
   - Recomendacion: introducir modelo nuevo de orden interna y pagos por migraciones incrementales.

### Alta

1. `settings` no es legible por `anon`, pero el frontend publico la consulta.
   - Riesgo: contenido CMS publico puede fallar en produccion y depender de fallback/error handling.
   - Recomendacion: separar settings publicos/privados o agregar policy select anon solo para keys publicas.

2. Faltan constraints de importes, precios y moneda.
   - Riesgo: precios o pagos invalidos pueden persistir si llegan por service role/webhook.
   - Recomendacion: checks incrementales, preferentemente `NOT VALID` si hay datos existentes.

3. `profiles` no tiene flujo versionado de creacion/actualizacion.
   - Riesgo: usuarios registrados pueden no tener perfil y quedar sin rol util; admin depende de datos manuales.
   - Recomendacion: trigger seguro para crear perfiles y politica controlada de update de campos no sensibles.

4. `is_admin()` es `SECURITY DEFINER` y usa `search_path = public`.
   - Riesgo: aunque schema-qualifica `public.profiles`, el patron no es el mas endurecido para funciones SD.
   - Recomendacion: reemplazar por funcion con `search_path = ''`, nombres totalmente calificados y grants minimos.

5. `orders.external_reference` unique puede bloquear reintentos o multiples eventos por referencia.
   - Riesgo: reconciliacion de pagos o reintentos puede fallar si dos pagos comparten referencia.
   - Recomendacion: disenar `orders.id` como referencia interna y `payment_events` para eventos del proveedor.

### Media

1. `products` carece de stock, SKU, slug, moneda y `updated_at`.
2. `settings` no distingue configuracion publica de privada.
3. `orders.user_id` referencia `profiles(id)` en vez de `auth.users(id)` directamente.
4. No hay indices de catalogo para `is_active/display_order/featured/category`.
5. No hay views o aliases de compatibilidad para transicion a `primary_image_url` o estados nuevos.
6. `update_updated_at_column()` tiene grants innecesarios a roles cliente.

### Baja

1. No hay enums nativos; los `CHECK` actuales son suficientes para MVP basico pero menos expresivos que el modelo objetivo.
2. `products` permite nulos en columnas que el frontend trata como obligatorias, como `image_url` y flags booleanos.

## Diferencias contra `COMMERCE_HARDENING_PLAN.md`

| Severidad | Estado real | Estado objetivo | Riesgo | Cambio incremental recomendado | Dependencias | Migracion de datos | Compat frontend |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Critica | Grants/default privileges amplios | Permisos minimos por rol | Exposicion futura por objetos sin RLS | Revocar `ALL` y conceder `SELECT/INSERT/UPDATE/DELETE` puntuales | Pruebas RLS | No | Puede romper admin si policies son incompletas |
| Critica | `orders` plana por webhook | Orden interna con items, stock, pagos y estados separados | Sin trazabilidad ni stock | Crear tablas/columnas nuevas sin borrar `orders.status` al inicio | Diseno checkout | Si, para historico si existe | Si, admin espera `orders.status` |
| Alta | Sin `order_items` | Snapshots normalizados | Items en JSON no consultables/validables | Crear `order_items` y poblar desde nuevas ordenes | Nuevo checkout | Historico opcional | Requiere API admin nueva |
| Alta | Sin `stock_reservations` ni stock en products | Reserva atomica y control de inventario | Overselling | Agregar columnas stock y tabla reservas | Definir reserva | Si para stock inicial | Frontend debe mostrar stock |
| Alta | Sin `payment_events` | Webhooks idempotentes auditables | Duplicados y falta de auditoria | Crear tabla eventos y adaptar webhook | Validacion firma MP | No inicial | Backend only |
| Alta | `settings` sin lectura anon | CMS publico controlado | Landing publica falla | Policy select anon limitada a keys publicas o vista publica | Definir keys publicas | No | Arregla frontend actual |
| Alta | `profiles.role text user/admin` | `profile_role admin/customer` y campos cliente | Roles no alineados | Agregar enum/constraint compatible o migrar progresivo | Decidir rol cliente | Si para `user -> customer` | Puede romper `AuthProvider` si se renombra sin mapper |
| Alta | `is_admin()` SD con `search_path public` | Funcion endurecida | Riesgo SD evitable | Recreate function con `search_path = ''` | Pruebas admin | No | No deberia romper |
| Media | `products.image_url` | `primary_image_url` + `product_images` | Galeria limitada | Agregar `primary_image_url` o mantener alias temporal | Redisenio catalogo | Si copy desde `image_url` | Rompe si se elimina `image_url` |
| Media | Sin checks `price > 0`, `amount >= 0`, `currency = ARS` | Constraints economicas | Datos invalidos | Agregar checks `NOT VALID`, luego validar | Revisar datos existentes | Puede requerir correccion | No directo |
| Media | Sin `updated_at` en products/profiles | Triggers updated_at | Auditoria incompleta | Agregar columnas y trigger generico | Ninguna | Backfill simple | No |
| Media | Sin indices catalogo parciales | Indices por activos/featured/category | Performance catalogo | Crear indices nuevos | Ninguna | No | No |

## Objetos que deben conservarse

- `profiles`: conservar IDs y relacion con Auth; migrar roles y campos de forma compatible.
- `products`: conservar catalogo actual y `image_url` mientras el frontend use `imageUrl`.
- `settings`: conservar keys CMS (`hero_content`, `about_content`) y definir exposicion publica controlada.
- `orders`: conservar historial; no dropear ni recrear. Introducir columnas/tablas nuevas y alias temporal para `status`.
- `public.is_admin()`: conservar concepto, pero endurecer implementacion y grants.
- `public.update_updated_at_column()`: reutilizable, con grants acotados.

## Estrategia de migraciones incrementales futura

No se escribieron migraciones en esta fase.

Orden recomendado:

1. Migracion de permisos minimos y RLS, con pruebas locales/staging antes de produccion.
2. Ajuste de `settings` para lectura publica controlada sin exponer settings privados.
3. Endurecimiento de `is_admin()` con `search_path` estricto y grants minimos.
4. Agregar columnas compatibles a `profiles` y trigger de creacion de perfil.
5. Agregar constraints economicas `NOT VALID` y validarlas luego de revisar datos.
6. Extender `products` con SKU/slug/currency/stock/updated_at sin eliminar columnas actuales.
7. Crear nuevas tablas `order_items`, `stock_reservations`, `inventory_movements`, `payment_events`.
8. Agregar funciones RPC transaccionales para checkout, reserva, consumo y liberacion de stock.
9. Migrar backend checkout/webhook para usar orden interna y payment events.
10. Migrar frontend/admin manteniendo compatibilidad temporal con `orders.status` e `image_url`.

## Bloqueos y no verificable

- No se consultaron datos, por lo que no se sabe si constraints futuras fallarian por filas existentes.
- No se verifico Auth, Storage, Edge Functions ni configuraciones remotas fuera del dump `public`.
- La CLI no mostro una etiqueta dashboard `PRODUCTION`; se verifico el proyecto por nombre exacto y la ausencia de preview branches.
- No se puede probar acceso efectivo anon/auth/admin sin ejecutar consultas como esos roles; esta auditoria se limita a schema, grants y policies.
- No se verifico si hay backups o staging disponible para probar migraciones.

## Proximo paso recomendado

Detener Fase 1A aqui. La siguiente fase debe disenar migraciones incrementales de hardening a partir de este baseline, empezando por permisos/RLS y compatibilidad de `settings`, sin aplicar nada directo en produccion hasta probar en staging.
