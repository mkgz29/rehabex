# ADMIN-01C — carga segura de imágenes y base de medios

ADMIN-01C reactiva la carga de imágenes del panel (deshabilitada en ADMIN-01A) mediante un flujo de upload firmado a Cloudinary, verificado criptográficamente por el servidor y registrado en una tabla `media_assets` propia. Ningún upload sin firmar, ningún `upload_preset`, y el `API_SECRET` de Cloudinary nunca sale del servidor.

## Arquitectura

```text
Panel (ImageField)
→ POST /api/admin/media/sign          { intent: product|hero|about }
    requireAdmin → RPC admin_create_pending_media_asset → firma Cloudinary
← { uploadUrl, cloudName, apiKey, timestamp, publicId, folder, signature, ... }

Navegador → POST directo a Cloudinary (multipart/form-data, mismos parámetros firmados)
← Cloudinary responde { public_id, version, signature, ... }

Panel → POST /api/admin/media/finalize   { publicId, version, signature }
    requireAdmin
    → verifica signature (cloudinary.utils.api_sign_request, SDK oficial)
    → GET autoritativo a Cloudinary Admin API (cloudinary.api.resource)
    → valida formato/bytes/dimensiones/resource_type sobre ESA respuesta
    → RPC admin_finalize_media_asset (auth.uid() + is_admin() + auditoría)
← { mediaAssetId, url, status }

Panel → POST /api/admin/products/{create,update} o /api/admin/settings/{hero,about}
    payload incluye imageAssetId (nunca una URL elegida por el cliente)
    → RPC admin_*_with_media resuelve la URL canónica desde media_assets,
      llama a la RPC ADMIN-01B sin modificarla, y marca el asset attached
      (y el anterior, si existía, orphan_candidate) en la misma transacción
```

## Variables requeridas (sin valores)

```env
CLOUDINARY_CLOUD_NAME=
CLOUDINARY_API_KEY=
CLOUDINARY_API_SECRET=
```

Server-only. Nunca existe `VITE_CLOUDINARY_*`. No se usa `upload_preset` unsigned en ningún punto del código ni de la configuración.

## Por qué el secreto nunca llega al cliente

- `CLOUDINARY_API_SECRET` se lee una sola vez en `server/admin/cloudinaryClient.ts` (`cloudinaryEnv()`), server-only.
- La firma (`cloudinary.utils.api_sign_request`, SDK oficial) se calcula en `/api/admin/media/sign` y sólo se devuelve el resultado (una firma de un solo uso, ligada a `public_id+timestamp+folder+...`), nunca el secreto.
- La verificación del resultado (`/api/admin/media/finalize`) reutiliza la misma función del SDK, replicando exactamente lo que hace `cloudinary.utils.verify_api_response_signature` internamente, en su variante tipada.
- `test('secure signed upload is active...')` en `tests/admin/safetyFoundation.test.ts` y las pruebas de contrato comprueban por código fuente y por respuesta HTTP que el secreto no aparece en ningún lado accesible al navegador.

## Parámetros firmados y su caducidad

El servidor decide, nunca el cliente: `timestamp`, `public_id` (`crypto.randomUUID()`), `folder` (mapeado 1:1 desde `intent`, ver más abajo), `overwrite=false`, `allowed_formats=jpg,jpeg,png,webp`, `max_file_size=8388608`. El cliente sólo envía `intent`.

La caducidad de 5 minutos **no** depende de la tolerancia propia de Cloudinary sobre `timestamp` (que es más laxa): `admin_create_pending_media_asset` crea una fila `authorized` con `created_at = now()`, y `admin_finalize_media_asset` rechaza con `ADM10` (`409`) cualquier finalización cuya fila tenga más de 5 minutos, sin importar que Cloudinary hubiera aceptado el upload igual.

```text
FOLDER_BY_INTENT = { product: 'rehabex/products', hero: 'rehabex/hero', about: 'rehabex/about' }
```

El cliente nunca elige folder, public ID, `overwrite`, `resource_type`, moderación, tags ni contexto administrativo.

## Formatos y límites

JPEG/JPG, PNG, WebP. Rechazados: SVG, GIF, PDF, video, HTML, binarios desconocidos. Máximo 8 MB; dimensiones entre 400×400 y 6000×6000 px. Estos límites están triplicados: como parámetros firmados que Cloudinary mismo hace cumplir (`allowed_formats`, `max_file_size`), como validación del resultado autoritativo en `/finalize` (`validateResourceMetadata`), y como `CHECK` constraints en `media_assets`.

## Verificación del resultado (la parte que importa)

El navegador **nunca es la fuente de verdad** para formato, tamaño o dimensiones — sólo para *cuál* upload es, mediante `publicId + version + signature`. La razón: `cloudinary.utils.verify_api_response_signature` sólo firma `public_id` y `version`; un navegador modificado podría mentir sobre el resto de los campos de la respuesta de Cloudinary sin invalidar esa firma. Por eso `/finalize` recibe sólo esos tres campos y, tras verificar la firma, llama a `cloudinary.api.resource(publicId)` (Admin API, credenciales de servidor) para obtener formato/bytes/ancho/alto/`resource_type`/`secure_url` reales, y valida *esa* respuesta.

Orden de verificación en `/api/admin/media/finalize`:
1. `verifyUploadSignature` (SDK oficial) sobre `publicId+version` — si falla, `422` sin más acciones.
2. `cloudinary.api.resource(publicId)` — la fuente autoritativa.
3. `validateResourceMetadata` — formato permitido, `resource_type=image`, bytes y dimensiones dentro de rango.
4. `isCloudinarySecureUrl` — el host es `res.cloudinary.com`.
5. Si 3 o 4 fallan: la firma ya demostró que el `public_id` es nuestro, así que se intenta `cloudinary.uploader.destroy` (operación oficial del SDK) y se audita el resultado sin afirmar éxito si `destroy` falla.
6. Si 1 falla (firma inválida) o el `public_id` no corresponde a ninguna autorización nuestra: no se intenta destruir nada — podría ser un asset ajeno no relacionado con esta cuenta, y borrar por error sería peor que no borrar.

## Modelo `media_assets`

`id, provider, public_id (único), folder, secure_url, format, mime_type, bytes, width, height, status, created_by, created_at, updated_at, attached_at, replaced_at`. `provider` limitado a `'cloudinary'`; `secure_url` con `CHECK` HTTPS; `bytes`/`width`/`height` con los mismos límites que la validación de aplicación.

**Estados** (más granulares que el mínimo pedido, documentados explícitamente):
- `authorized`: `/sign` emitió una firma; no hay upload verificado todavía.
- `pending`: `/finalize` verificó el resultado; el asset existe pero no está referenciado por ningún producto ni documento.
- `attached`: referenciado actualmente por un producto o un documento de settings.
- `orphan_candidate`: estuvo `attached`, fue reemplazado; no se borra automáticamente (ver más abajo).

## RLS y grants

`FORCE ROW LEVEL SECURITY` + `ENABLE ROW LEVEL SECURITY`. Única política: `SELECT` para `authenticated` filtrado por `is_admin()`. **Ninguna** política ni grant de `INSERT/UPDATE/DELETE` existe para ningún rol, `service_role` incluido: el único escritor es la RPC, que corre como dueña de la tabla. `anon` no tiene ningún grant, ni siquiera `SELECT`.

## RPC creadas

- `admin_create_pending_media_asset(public_id, folder, request_id)` — crea la fila `authorized`.
- `admin_finalize_media_asset(public_id, secure_url, format, mime_type, bytes, width, height, request_id)` — verifica pertenencia (`created_by = auth.uid()`), vigencia (5 min), formato/tamaño/dimensiones; pasa a `pending`; audita `media.finalized`; idempotente si se repite el mismo `secure_url` sobre una fila ya `pending`.
- `admin_create_product_with_media(..., image_asset_id, ...)` / `admin_update_product_with_media(..., image_asset_id, ...)` — envuelven (llaman, sin modificarlas) a `admin_create_product` / `admin_update_product` de ADMIN-01B; resuelven `image_asset_id → secure_url`, marcan el asset `attached`, y si reemplazan uno anterior lo marcan `orphan_candidate` y lo auditan (`media.orphaned`).
- `admin_upsert_settings_document_with_media(key, value, image_asset_id, ...)` — misma envoltura para Hero/About; sobrescribe el campo de imagen del documento (`image_url` o `image`) con la URL resuelta, nunca con lo que mandó el cliente.

Todas: `SECURITY DEFINER`, `search_path=''`, exigen `auth.uid()` + `is_admin()`, `EXECUTE` sólo para `authenticated`. Un asset ya `attached` no puede reutilizarse (`asset_not_available`, `422`); un asset de otra sesión no puede finalizarse ni adjuntarse (`forbidden`, `403`).

**Nota de esquema:** `admin_audit_events` tenía un índice único sobre `request_id` (ADMIN-01B), que asumía un evento por request. Adjuntar un asset añade un segundo evento (`media.attached`, junto a `product.created`) bajo el mismo `request_id`; el índice se reemplazó por uno sobre `(request_id, action)`, documentado y con rollback incluido en esta misma migración.

## Auditoría

`media.finalized`, `media.attached`, `media.orphaned`, además de las acciones ya existentes de productos/settings (que ahora pueden compartir `request_id` con un evento de medios). Nunca se audita el secreto, la firma completa, el token, ni la respuesta completa de Cloudinary — sólo campos administrativos permitidos (estado antes/después, dimensiones, formato, bytes).

## Imágenes heredadas y compatibilidad

`products.image_url` se conserva; se agrega `image_asset_id uuid NULL REFERENCES media_assets(id)`. Un producto sin asset (imagen heredada, cargada antes de ADMIN-01C) sigue funcionando exactamente igual: al editar sin tocar la imagen, el cliente reenvía el `imageUrl` actual (como en ADMIN-01B) y el wrapper no toca `image_asset_id`. Nada migra automáticamente. Para Hero/About, el identificador del asset se guarda dentro del propio documento JSON validado (`image_asset_id`), junto al campo de imagen existente (`image_url` / `image`); documentos guardados antes de ADMIN-01C simplemente no tienen esa clave.

## Assets pendientes y huérfanos

- Si el upload a Cloudinary falla: no hay fila `pending` que registrar; el admin puede reintentar sin fricción (una fila `authorized` sin usar no bloquea nada).
- Si `/finalize` falla después de un upload real: el asset **no** se pierde silenciosamente — queda en Cloudinary y, si la firma era válida pero la política no, se intenta destruir (ver arriba); si ni siquiera se puede autorizar, no se destruye y queda como incidente para revisión manual (nunca se afirma un borrado que no se confirmó).
- Si el asset se finaliza pero el guardado del producto/documento falla después: el asset queda `pending` (no huérfano, no perdido); el admin puede reintentar el guardado reutilizando el mismo `mediaAssetId` sin volver a subir el archivo.
- **No hay borrado físico automático en ADMIN-01C.** `orphan_candidate` es sólo un estado; nada lo purga.

**Reservado para una fase posterior:** período de gracia antes de purgar, verificación de que ningún producto/documento referencia el asset, un job o endpoint de limpieza, destrucción idempotente en Cloudinary con reintentos, auditoría de la purga, y una ventana de recuperación antes de destruir.

## Amenazas mitigadas

- Upload unsigned / preset unsigned: eliminado; todo pasa por parámetros firmados de un solo uso.
- Folder o public ID elegidos por el cliente: imposibles — el servidor los genera y sólo reconoce los que él mismo autorizó.
- Reutilización de la respuesta de otro upload o de otra sesión: rechazada por `created_by <> auth.uid()` y por el estado (`asset_not_available` si no está `pending`).
- Autorización vencida reutilizada más tarde: rechazada (`ADM10`) independientemente de la tolerancia propia de Cloudinary.
- Navegador mintiendo sobre formato/tamaño/dimensiones: irrelevante — el servidor nunca los toma de ahí, los pide a la Admin API.
- SVG/GIF/PDF/video/HTML: rechazados en tres capas (parámetros firmados, verificación de resultado, `CHECK` en base).
- Escritura directa a `media_assets` desde el navegador: imposible (sin política de escritura para ningún rol).
- Secreto de Cloudinary expuesto al cliente: nunca sale del servidor; probado por código fuente y por respuesta HTTP.

## Riesgos pendientes (documentados, no resueltos aquí)

- No hay job de limpieza de `orphan_candidate`: pueden acumularse assets sin referencia indefinidamente hasta ADMIN-02/03.
- `destroyAsset` es best-effort: si Cloudinary no responde, el incidente queda sólo en los logs de la aplicación, sin reintento automático.
- No hay límite de tasa dedicado para `/sign`/`/finalize` (ADMIN-01B no lo tenía tampoco para sus propios endpoints administrativos; se hereda la misma postura).
- Galería múltiple, recorte/focal point y variantes responsive quedan fuera de alcance.

## Procedimiento local

1. Confirmar contenedor `supabase_db_Rehabex`, puerto local `56322`/`56321`, `project_id` local `Rehabex`, sin `--linked`, sin URLs remotas.
2. Aplicar la migración `202609230301_admin_01c_secure_media.sql` con `psql` dentro del contenedor.
3. Ejecutar `supabase/tests/admin_01c_secure_media.sql` (transacción con `ROLLBACK`).
4. Ejecutar `npm run build`, `check:api`, `test:api`, `test:cart`, `test:admin:safety`, `test:admin:boundary`, `test:admin:media`.
5. Smoke end-to-end (script ad-hoc, no versionado): sign → "upload" simulado → finalize → crear producto con imagen → reemplazar imagen de producto → editar Hero → editar About → intentar reutilizar un asset ya adjunto → usuario no admin. Cloudinary siempre mockeado a nivel de dependencia inyectada; cero llamadas de red reales.

## Procedimiento futuro para Vercel (no ejecutado en ADMIN-01C)

Cargar `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` como variables de entorno de servidor en el proyecto de Vercel (nunca con prefijo `VITE_`), separadas por entorno (Preview/Production) según la cuenta de Cloudinary que corresponda. Confirmar que `ALLOWED_ORIGINS` sigue correcto para el dominio real antes de habilitar el flujo en producción.

## Orden futuro de migración y despliegue

1. Validar esta migración localmente (hecho en ADMIN-01C).
2. Bloque separado `RELEASE-00`: revisar todas las migraciones pendientes (ADMIN-01A, 01B, 01C) como una unidad, aplicar a staging si existe, y sólo después a producción.
3. Configurar las variables de Cloudinary en Vercel antes de desplegar el código que las usa.
4. No aplicar esta migración a producción sin la revisión de `RELEASE-00`.

## Rollback

`supabase/rollbacks/202609230301_admin_01c_secure_media.rollback.sql`: elimina las cinco RPC nuevas y la columna `products.image_asset_id`; restaura el índice único original de `admin_audit_events`. **No** elimina `media_assets` ni ninguna fila ya registrada. No elimina archivos ya subidos a Cloudinary (esta migración nunca los borra por sí misma). Sólo para uso local; nunca contra remoto.

## Fuera de alcance (reservado para ADMIN-02/ADMIN-03)

Galería múltiple de productos, recorte/focal point, variantes responsive generadas automáticamente, job de limpieza de huérfanos, purga real en Cloudinary, panel de revisión de incidentes de destrucción fallida, roles adicionales, gestión de usuarios.
