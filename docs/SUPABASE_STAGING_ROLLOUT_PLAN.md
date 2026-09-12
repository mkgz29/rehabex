# Supabase staging rollout plan - Rehabex

Fecha: 2026-09-11

Alcance: Fase 1C, evaluacion y preparacion de un entorno Supabase staging para probar el baseline real y las migraciones incrementales de Fase 1B. Este documento no aplica migraciones, no ejecuta SQL remoto y no modifica ningun proyecto Supabase.

## Resultado de evaluacion

Se listo metadata minima de proyectos mediante Supabase CLI. Se verifico que produccion existe como `rehabex-cms`, estado activo y region `sa-east-1`.

No se encontro un proyecto separado identificable inequivocamente como staging de Rehabex. No se debe usar `rehabex-cms` como staging y no se debe asumir que una preview branch equivale a staging dedicado.

## Entorno staging objetivo

| Campo | Definicion |
| --- | --- |
| Nombre sugerido | `rehabex-staging` |
| Organizacion propietaria | La misma organizacion propietaria de `rehabex-cms`; confirmar visualmente en Dashboard. No registrar IDs ni slugs sensibles en documentos. |
| Region recomendada | `sa-east-1`, para mantener compatibilidad operacional con produccion. Pendiente de confirmar disponibilidad al crear staging. |
| Rama/entorno | Proyecto independiente de produccion; etiqueta operativa `STAGING`. |
| Datos reales | Prohibidos. No restaurar clientes, usuarios, ordenes ni payloads reales. |
| Datos minimos | Usuarios ficticios admin/customer, productos ficticios activos/inactivos, settings publicos/privados ficticios y ordenes ficticias representativas. |
| Mercado Pago | Usar credenciales y webhooks de modo test/sandbox, separados de produccion. |
| Variables de entorno | Separadas para frontend, funciones serverless y CI local. No reutilizar URLs, anon keys, service-role keys ni secretos de produccion. |
| Credenciales DB | Separadas y obtenidas solo por flujo interactivo oficial o Dashboard; no documentarlas ni pegarlas en chat. |

## Principios de seguridad

- Produccion `rehabex-cms` queda intacta.
- El workspace actual conserva el vinculo local con produccion y no se reutiliza para aplicar staging.
- Staging se opera desde un worktree o copia de trabajo separada.
- El baseline `supabase/baseline/20260911_remote_public_schema.sql` es una fotografia de estructura, no una migracion productiva.
- El baseline solo puede cargarse en un proyecto staging vacio o descartable.
- Antes de cada comando remoto futuro se debe verificar que el destino visible por CLI sea `rehabex-staging`, no `rehabex-cms`.
- No se registran project refs, connection strings, tokens, passwords ni service-role keys en Git.

## Bootstrap del schema baseline

Staging debe inicializarse desde un proyecto Supabase vacio. El objetivo es reproducir primero el schema real de produccion y recien despues aplicar las migraciones incrementales probadas localmente.

Estrategia propuesta:

1. Crear o seleccionar un proyecto dedicado `rehabex-staging` en la misma organizacion que produccion.
2. Confirmar que el proyecto no contiene datos reales y que `public` no tiene tablas de Rehabex preexistentes.
3. Trabajar desde un worktree separado, por ejemplo una carpeta local distinta para staging.
4. Vincular ese worktree separado al proyecto staging, no al workspace productivo actual.
5. Cargar el baseline con `psql` o flujo oficial equivalente contra la base staging vacia.
6. Aplicar luego las tres migraciones de Fase 1B en orden.
7. Ejecutar smoke tests y pruebas RLS contra datos ficticios.

Comando futuro propuesto para cargar el baseline en staging, no ejecutado en esta fase:

```bash
psql "$STAGING_DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/baseline/20260911_remote_public_schema.sql
```

Este comando es destructivo si se usa contra el destino incorrecto o contra un schema no vacio. Solo puede ejecutarse despues de verificar interactivamente que la connection string pertenece a `rehabex-staging` y que no apunta a `rehabex-cms`.

## Evitar aplicar baseline sobre produccion

Controles obligatorios:

- No ejecutar el baseline desde el workspace productivo actual.
- Usar un worktree o copia llamada explicitamente para staging.
- Confirmar con `npx supabase projects list --output json` que el proyecto con marca `linked` sea `rehabex-staging`.
- Ejecutar una comprobacion local que compare el project ref vinculado con el ref elegido para staging sin imprimirlo.
- Mantener cerradas o separadas las terminales de produccion y staging.
- Usar variables con prefijo `STAGING_` para credenciales de staging.
- No exportar `DATABASE_URL` generica en la terminal de staging.
- Antes de correr `psql`, imprimir solo el nombre esperado del proyecto y un booleano de verificacion, nunca la URL.

Si cualquier comprobacion indica `rehabex-cms`, se debe abortar.

## Migraciones de Fase 1B a aplicar en staging

Orden futuro, no ejecutado en esta fase:

1. `supabase/migrations/202609110101_harden_existing_permissions.sql`
2. `supabase/migrations/202609110102_profiles_products_foundation.sql`
3. `supabase/migrations/202609110103_orders_commerce_foundation.sql`

Aplicacion propuesta contra staging:

```bash
psql "$STAGING_DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/202609110101_harden_existing_permissions.sql
psql "$STAGING_DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/202609110102_profiles_products_foundation.sql
psql "$STAGING_DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/202609110103_orders_commerce_foundation.sql
```

No usar `supabase db push` para esta primera validacion de staging, porque el baseline no vive como migracion y el objetivo es reproducir el flujo ya probado localmente: baseline primero, migraciones incrementales despues.

## Preservar el vinculo con produccion

El workspace actual debe conservar su vinculo local a `rehabex-cms`. Para staging conviene usar un worktree:

```bash
git worktree add ../Rehabex-staging main
```

En el worktree de staging se podra ejecutar en el futuro:

```bash
npx supabase link --project-ref <STAGING_PROJECT_REF>
```

Despues de terminar pruebas, se debe borrar o archivar solo el worktree staging si ya no se necesita. El workspace productivo no requiere relink. Si por error se modifica el vinculo del workspace productivo, se debe detener el trabajo y restaurar el vinculo a produccion mediante flujo oficial, sin aplicar SQL ni migraciones.

## Comandos destructivos y limites

| Comando | Riesgo | Permitido en staging futuro | Limite obligatorio |
| --- | --- | --- | --- |
| `psql ... -f supabase/baseline/...` | Crea/recrea estructura esperada y puede fallar o mezclar schema si el destino no esta vacio | Si | Solo proyecto `rehabex-staging` vacio y verificado |
| `psql ... -f supabase/migrations/...` | Modifica schema remoto | Si | Solo despues de baseline aplicado en staging y verificacion de destino |
| `supabase db reset --linked` | Destructivo para DB vinculada | Evitar | No usar salvo runbook especifico para staging descartable y confirmacion fuera de este plan |
| `supabase db push` | Aplica migraciones al proyecto vinculado | No recomendado para esta validacion | No usar hasta definir estrategia formal post-staging |
| `supabase migration repair` | Cambia historial remoto de migraciones | No | Prohibido para esta fase y no recomendado sin plan de recuperacion |

## Tests requeridos

SQL y RLS:

- Ejecutar `supabase/tests/phase1b_local_smoke.sql` adaptado para staging si requiere datos de Auth o roles creados de forma segura.
- Confirmar 16/16 aserciones equivalentes.
- Confirmar `anon` lee productos activos y settings publicos permitidos.
- Confirmar `anon` no lee ni escribe ordenes.
- Confirmar `anon` no escribe productos, settings ni perfiles.
- Confirmar customer autenticado lee solo orden propia.
- Confirmar customer no modifica `profiles.role`.
- Confirmar admin lee y muta productos/settings.
- Confirmar RPCs service-role crean orden, items, reserva y consumo/liberacion de stock.
- Ejecutar `npx supabase db lint --linked` solo contra staging verificado.

Frontend y backend:

- Ejecutar `npm run build` con variables de staging no secretas para el frontend.
- Validar landing/settings publicos contra `rehabex-staging`.
- Validar panel admin contra usuarios ficticios.
- Validar que Mercado Pago use modo test y URLs/webhooks de staging.
- No conectar frontend staging a service-role desde cliente.

## Evidencias necesarias

- Captura o registro textual sin IDs sensibles de que `rehabex-staging` existe y esta activo.
- Region confirmada.
- Confirmacion de que pertenece a la organizacion correcta.
- Confirmacion de que el worktree staging esta vinculado a staging.
- Resultado de carga de baseline.
- Resultado de cada migracion.
- Resultado de lint.
- Resultado de smoke test 16/16.
- Resultado de pruebas RLS manuales o automatizadas.
- Resultado de build frontend.
- Lista de variables esperadas, sin valores.
- Incidencias y decisiones de rollback, si las hubo.

## Rollback

Antes de tocar produccion, staging debe demostrar rollback operativo.

Para staging descartable:

- Si falla baseline o migraciones, eliminar y recrear el proyecto staging o restaurarlo desde backup/snapshot de staging.
- No reparar historial con `migration repair` salvo plan especifico.
- No copiar errores de staging a produccion.

Para produccion futura:

- Preparar backup antes de cada migracion.
- Aplicar migraciones en ventana controlada.
- Tener scripts de rollback por migracion cuando sean reversibles.
- Para cambios no reversibles o con backfill, definir rollback de compatibilidad: nuevas columnas/tables quedan sin uso mientras backend/frontend vuelven al flujo anterior.

## Criterios de aceptacion

- `rehabex-staging` existe como proyecto independiente de `rehabex-cms`.
- Staging usa credenciales, variables, URLs y Mercado Pago test separados.
- No hay datos reales en staging.
- Baseline real carga correctamente en staging vacio.
- Las tres migraciones de Fase 1B aplican en orden sin errores.
- `supabase/tests/phase1b_local_smoke.sql` o su variante staging pasa 16/16.
- DB lint no reporta errores criticos.
- Pruebas RLS confirman accesos esperados para anon, customer, admin y service-role.
- Frontend actual compila y funciona contra staging sin exponer secretos.
- Se conserva compatibilidad con `orders.status`, `orders.items` y `products.image_url`.
- Existe evidencia suficiente para decidir si promover a produccion.

## Promocion futura a produccion

Produccion solo debe considerarse despues de staging aprobado.

Procedimiento futuro:

1. Revisar resultados de staging y ajustar migraciones si corresponde.
2. Crear backup de produccion.
3. Confirmar ventana de mantenimiento.
4. Confirmar que el workspace productivo esta vinculado a `rehabex-cms`.
5. Ejecutar un dry-run documental del orden exacto de comandos.
6. Aplicar migraciones incrementales, no el baseline.
7. Ejecutar pruebas RLS de bajo impacto y smoke compatible con produccion sin datos ficticios invasivos.
8. Verificar frontend y admin.
9. Registrar evidencias y estado final.

## Runbook propuesto para la siguiente fase

Este runbook es propuesta. No fue ejecutado en Fase 1C.

### 1. Crear o seleccionar staging

- Crear proyecto `rehabex-staging` en Supabase.
- Usar la misma organizacion que `rehabex-cms`.
- Elegir `sa-east-1` si esta disponible.
- Confirmar que no contiene datos reales.

### 2. Obtener credenciales por flujo interactivo

- Obtener password de DB y keys de staging desde Dashboard o prompt oficial.
- No pegarlas en chat.
- Guardarlas solo en el gestor local/CI seguro correspondiente.

### 3. Vincular desde entorno local separado

```bash
git worktree add ../Rehabex-staging main
cd ../Rehabex-staging
npx supabase login
npx supabase link --project-ref <STAGING_PROJECT_REF>
```

### 4. Confirmar destino

```bash
npx supabase projects list --output json
```

Confirmar sin imprimir refs que:

- `rehabex-staging` aparece activo.
- El proyecto vinculado es `rehabex-staging`.
- `rehabex-cms` no esta marcado como vinculado en ese worktree.

### 5. Aplicar baseline

```bash
psql "$STAGING_DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/baseline/20260911_remote_public_schema.sql
```

Abortar si la URL no es de staging o si el schema no esta vacio.

### 6. Aplicar migraciones Fase 1B

```bash
psql "$STAGING_DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/202609110101_harden_existing_permissions.sql
psql "$STAGING_DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/202609110102_profiles_products_foundation.sql
psql "$STAGING_DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/202609110103_orders_commerce_foundation.sql
```

### 7. Ejecutar lint

```bash
npx supabase db lint --linked
```

Solo despues de confirmar que el link del worktree apunta a `rehabex-staging`.

### 8. Ejecutar smoke test 16/16

```bash
psql "$STAGING_DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/phase1b_local_smoke.sql
```

Si se adapta el smoke para staging, conservar las 16 aserciones y documentar la diferencia.

### 9. Ejecutar pruebas RLS

- Probar anon.
- Probar customer ficticio.
- Probar admin ficticio.
- Probar service-role solo desde backend/CLI seguro.
- Registrar resultados sin datos personales.

### 10. Verificar frontend con variables de staging

- Configurar variables `VITE_` de staging.
- Configurar funciones/serverless con secretos de staging.
- Confirmar Mercado Pago test.
- Ejecutar `npm run build`.
- Probar landing, catalogo, admin productos y admin ordenes con datos ficticios.

### 11. Registrar resultados

- Guardar reporte de comandos ejecutados, sin secretos.
- Registrar errores y decisiones.
- Adjuntar resultado de smoke, lint y build.

### 12. Rollback si falla

- Detener aplicacion de pasos siguientes.
- Descartar o restaurar staging.
- No tocar produccion.
- Ajustar migraciones localmente y repetir desde staging limpio.

## Bloqueos actuales

- No existe staging dedicado verificable por CLI.
- No se verifico nombre visible de la organizacion propietaria, solo que produccion pertenece a una organizacion en Supabase.
- No se crearon credenciales ni variables de staging.
- No se ejecutaron comandos destructivos ni SQL remoto.

## Proximo paso recomendado

Miguel debe crear o seleccionar un proyecto Supabase dedicado llamado `rehabex-staging`, en la misma organizacion que `rehabex-cms`, idealmente en `sa-east-1`, sin datos reales y con credenciales separadas. Luego se debe ejecutar el runbook desde un worktree separado y detenerse antes de cualquier promocion a produccion.
