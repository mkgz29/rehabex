# ADMIN-01A — aislamiento local y seguridad operativa

ADMIN-01A establece barreras de desarrollo y catálogo sin habilitar funciones administrativas nuevas. Toda validación de base de datos debe ejecutarse contra el proyecto local `Rehabex`; no autoriza migraciones remotas, remediaciones de datos productivos, uploads, checkout ni acciones de Mercado Pago.

## Entorno local

- Clasificar el entorno con `REHABEX_DATA_ENV=local`.
- Usar Supabase solamente en `127.0.0.1:56321` (API) y `127.0.0.1:56322` (Postgres).
- Ejecutar `npm run dev` sólo con la URL y la clave pública del stack local en variables efímeras. No modificar `.env` ni `.env.local` para la validación.
- `npm run dev` ejecuta una guardia previa. Rechaza variables ausentes, URLs inválidas, backends remotos presentados como locales, staging no verificado, Cloudinary unsigned en local y Mercado Pago productivo.
- El build de producción no ejecuta esta guardia de desarrollo.

El bloque local reservado para Rehabex es 56320–56329. `supabase/config.toml` mantiene `project_id = "Rehabex"` y asigna API 56321, base 56322, Studio 56323, correo 56324 y analytics 56327. Estos puertos evitan el bloque 54320–54329 utilizado por ObraTrack.

## Catálogo fail-closed

Los productos de demostración fueron retirados del runtime. Home, Tienda, detalle y panel no sustituyen errores por productos o precios ficticios. Loading, vacío y error se representan como estados diferentes; los errores de Home y Tienda ofrecen reintento.

`isInternalCategory` es la única clasificación compartida para categorías reservadas. Compara el valor completo después de recortar espacios y sin distinguir mayúsculas, por lo que excluye `TEST` y `PRUEBA` sin excluir palabras parciales como `Contest`. `isPublicCatalogProduct` aplica esa clasificación junto con el estado activo en Home, destacados, categorías derivadas, Tienda, búsqueda y detalle público.

La migración `202609230101_admin_01a_public_catalog_safety.sql` replica la misma defensa en RLS para productos e imágenes públicas. No borra productos ni modifica precios, stock, órdenes o pagos. Los productos TEST/PRUEBA existentes en remoto continúan allí hasta una remediación productiva separada y expresamente aprobada.

## Imágenes

El upload unsigned desde el navegador fue retirado. El panel conserva la edición manual de la URL y la vista previa de la imagen existente; el control de carga se muestra deshabilitado con un mensaje explícito. Guardar otros campos no limpia la URL existente y una imagen vacía no bloquea la validación del formulario. ADMIN-01A no crea todavía un endpoint firmado.

## Validación local

1. Confirmar que el destino es el contenedor `supabase_db_Rehabex`, publicado sólo en el puerto local 56322.
2. Reproducir el esquema local desde una base vacía con el baseline local de validación y las migraciones versionadas 101–106, 108–110 y ADMIN-01A. La migración 107 queda fuera porque no forma parte del flujo versionado vigente.
3. Ejecutar `supabase/tests/admin_01a_public_catalog_safety.sql` con `psql` únicamente dentro del contenedor local validado. La prueba abre una transacción, usa fixtures sintéticos y finaliza con rollback.
4. El rollback manual está en `supabase/rollbacks/202609230101_admin_01a_public_catalog_safety.rollback.sql`; sólo restaura las políticas de lectura activa anteriores. No debe ejecutarse contra remoto.
5. Ejecutar `npm run test:admin:safety`, `npm run build`, `npm run check:api`, `npm run test:api` y `npm run test:cart`.

`test:db:concurrency` no forma parte de ADMIN-01A: valida concurrencia comercial de checkout, un área no modificada por este cierre.
