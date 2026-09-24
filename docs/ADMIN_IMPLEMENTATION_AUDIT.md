# ADMIN-00 — Auditoría técnica y arquitectura del administrador de Rehabex

## 1. Estado inicial y preflight

| Verificación | Resultado |
|---|---|
| Rama | `feature/rehabex-visual-refinement-phase-1b` |
| Commit | `4bd8fdaa25a1e634236bd37cc606a1bbc17d944d` |
| Commit esperado | Coincide exactamente |
| `git status --short` inicial | Vacío |
| Cambios locales iniciales | Ninguno |
| `git status --short` final | Vacío |
| Staging independiente | No existe uno confirmado |
| Supabase vinculado | El workspace y `.env` apuntan al proyecto productivo documentado |
| Migraciones remotas | `101–106` y `108–110` aplicadas; `107` no aplicada |
| Escrituras remotas durante ADMIN-00 | Cero |

Scripts disponibles:

- `dev`: Vite.
- `build`: TypeScript + Vite.
- `preview`: preview del build.
- `test:api`: contratos de checkout, webhook, recovery y reconciliación.
- `test:cart`: carrito y presentación de pagos.
- `test:db:concurrency`: concurrencia contra Supabase local; se niega expresamente a usar una URL remota.
- `check:api`: type-check de API y funciones Vercel.

Evidencia: [package.json](C:/Users/mikelus/Desktop/PROYECTOS/Rehabex/package.json), guardia local de concurrencia en [paymentAtomicConcurrency.test.ts](C:/Users/mikelus/Desktop/PROYECTOS/Rehabex/tests/db/paymentAtomicConcurrency.test.ts:6).

### Framework y arquitectura real

Es una SPA React 18 + TypeScript + Vite, con React Router, cliente Supabase en el navegador y funciones serverless en `api/`. Las funciones usan módulos server-only de `server/commerce/`, la clave `service_role` y el SDK de Mercado Pago. No hay SSR, React Query, ORM ni framework full-stack.

Directorios principales:

- `src/`: SPA, autenticación, tienda, carrito, CMS y panel.
- `src/admin/`: panel administrativo existente.
- `api/`: endpoints Vercel.
- `server/commerce/`: dominio de checkout/pagos.
- `supabase/migrations/`: migraciones desplegadas.
- `supabase/baseline/`: fotografía inicial del remoto.
- `supabase/tests/`: pruebas SQL locales.
- `public/`: marca y favicon.
- `tests/`: contratos API, carrito, UI y concurrencia.

Rutas: [App.tsx](C:/Users/mikelus/Desktop/PROYECTOS/Rehabex/src/App.tsx:23). Cliente Supabase: [supabase.ts](C:/Users/mikelus/Desktop/PROYECTOS/Rehabex/src/lib/supabase.ts:3). Cliente privilegiado sólo servidor: [commerce.ts](C:/Users/mikelus/Desktop/PROYECTOS/Rehabex/server/commerce/commerce.ts:150).

### Entorno que usarían los comandos locales

La comprobación segura, sin imprimir valores, confirmó que:

- `VITE_SUPABASE_URL` y `SUPABASE_URL` apuntan al mismo proyecto.
- Ese proyecto coincide con el workspace vinculado a producción.
- Hay configuración local de Cloudinary para upload desde navegador.
- Hay una credencial de Mercado Pago que no tiene prefijo explícito de test.
- Falta `MERCADOPAGO_ENV`, por lo que checkout falla cerrado antes de iniciar un pago.
- `PUBLIC_SITE_URL` es local y tampoco satisface el requisito HTTPS del backend.

Por tanto, `npm run dev` permitiría leer y, con una sesión admin, escribir en Supabase productivo y subir archivos al Cloudinary configurado. No se inició el servidor.

La falta de staging ya estaba documentada en [SUPABASE_STAGING_ROLLOUT_PLAN.md](C:/Users/mikelus/Desktop/PROYECTOS/Rehabex/docs/SUPABASE_STAGING_ROLLOUT_PLAN.md:9). `.env` está ignorado y no está versionado: [.gitignore](C:/Users/mikelus/Desktop/PROYECTOS/Rehabex/.gitignore:7).

---

## 2. Resumen ejecutivo

El administrador existe y algunas funciones son reales, pero todavía no constituye un CMS profesional.

- Hero, “Quiénes somos” y productos leen y escriben Supabase directamente desde el navegador.
- Las mutaciones están protegidas por sesión, grants y RLS basada en `profiles.role = 'admin'`; no encontré una escritura administrativa autorizada sólo por la UI.
- Ventas es lectura real a través de un endpoint que vuelve a validar token y rol en servidor.
- No hay administración de stock, categorías, galería, SKU, slug, publicación editorial, archivado, contacto, redes, anuncios ni medios de pago.
- Cloudinary es el alojamiento real de las imágenes productivas consultadas, pero el upload actual es unsigned y se ejecuta directamente desde el navegador.
- El catálogo tiene dos fuentes operativas: Supabase y `defaultProducts`. La Home puede sustituir un error remoto por productos ficticios.
- Producción expone al rol anónimo 6 productos activos; 3 tienen categoría `TEST`/`PRUEBA`. La Home los excluye, pero `/tienda` no.
- El checkout no confía en el precio o stock del navegador: el servidor envía solamente UUID y cantidad, y PostgreSQL recalcula, reserva y valida todo.
- El esquema de inventario es considerablemente más sólido que el panel: reservas, movimientos y transición atómica de pagos ya existen.
- La primera fase posterior debe ser ADMIN-01: entorno seguro, eliminación de exposición accidental de TEST, logs de sesión, hardening del upload y frontera administrativa con validación/auditoría.

No se encontró `service_role` incorporada al bundle: se usa sólo mediante `process.env` en servidor.

---

## 3. ¿Los productos están hardcodeados?

No exclusivamente.

La fuente usada en producción es `public.products`, consultada por Supabase. El servicio normaliza las filas en [cms.ts](C:/Users/mikelus/Desktop/PROYECTOS/Rehabex/src/services/cms.ts:109) y consulta catálogo, activos y detalle en [cms.ts](C:/Users/mikelus/Desktop/PROYECTOS/Rehabex/src/services/cms.ts:179).

Sin embargo, existe un array de siete productos con nombres, precios, categorías e imágenes Unsplash hardcodeados en [defaultContent.ts](C:/Users/mikelus/Desktop/PROYECTOS/Rehabex/src/lib/defaultContent.ts:3).

Se utiliza:

- Cuando Supabase no está configurado.
- Como estado inicial del panel de productos.
- Como reemplazo en la Home si falla la consulta real de productos, incluso cuando Supabase sí está configurado: [useLandingData.ts](C:/Users/mikelus/Desktop/PROYECTOS/Rehabex/src/hooks/useLandingData.ts:27).

Conclusión: Supabase es la fuente principal, pero aún no es la única fuente de verdad observable. `defaultProducts` puede aparecer en una ejecución productiva ante un error de lectura.

Además, los IDs del fallback no son UUID; el carrito los rechaza en [cartState.ts](C:/Users/mikelus/Desktop/PROYECTOS/Rehabex/src/cart/cartState.ts:21). Es posible mostrar un producto ficticio que no se puede comprar.

La consulta pública agregada de ADMIN-00, sin nombres ni valores comerciales, encontró:

- 6 productos activos visibles a `anon`.
- 3 categorizados como `TEST`/`PRUEBA`.
- 6 con `stock_on_hand`.
- 3 con SKU y slug.

---

## 4. ¿Las imágenes están hardcodeadas?

También es un modelo mixto.

- Productos, Hero y About productivos contienen URLs en Supabase.
- Las URLs productivas observadas pertenecen a `res.cloudinary.com`.
- Los productos fallback y el contenido fallback usan URLs Unsplash hardcodeadas: [defaultContent.ts](C:/Users/mikelus/Desktop/PROYECTOS/Rehabex/src/lib/defaultContent.ts:9).
- Logo, favicon y marcas de pago son archivos locales en `public/brand` y `src/assets/payments`.
- `product_images` existe como modelo relacional, pero no hay filas públicamente visibles y el frontend no lo consulta.
- El frontend de catálogo sigue leyendo `products.image_url`, no `primary_image_url` ni la galería: [cms.ts](C:/Users/mikelus/Desktop/PROYECTOS/Rehabex/src/services/cms.ts:25).

La consulta agregada encontró 3 productos activos con `image_url` y `primary_image_url`, ambos en Cloudinary. Los restantes activos no tienen una imagen productiva utilizable por el frontend actual.

---

## 5. Qué ya es dinámico

- Productos activos, precio, stock, categoría, estado destacado y orden.
- Hero: título, subtítulo, imagen, texto y destino del CTA.
- About: imagen, título y descripción.
- Productos destacados y selección comercial, derivados de `products`.
- Categorías del footer de la Home, derivadas del catálogo.
- Contador y contenido del carrito desde `localStorage`.
- Estado de autenticación y rol desde Supabase Auth + `profiles`.
- Órdenes del panel mediante `/api/orders`.
- Precio de envío desde `settings.commerce_shipping`, sólo usado por el checkout servidor.
- Año del footer, derivado del reloj.

---

## 6. Qué puede administrar hoy el cliente

Con una cuenta cuyo `profiles.role` sea `admin`:

- Editar Hero.
- Editar título, descripción e imagen de About.
- Editar métricas de About en la base, aunque hoy no se muestran.
- Crear productos.
- Editar nombre, descripción, categoría libre, precio, imagen, destacado, orden y activo.
- Eliminar físicamente productos, cuando las relaciones de inventario lo permitan.
- Subir imágenes directamente a Cloudinary.
- Ver hasta 200 órdenes recientes.

No puede administrar hoy:

- Stock.
- SKU o slug.
- Categorías como entidad.
- Galería y texto alternativo.
- Borrador/publicación/archivado.
- Historial o auditoría.
- Contacto, Instagram o WhatsApp.
- AnnouncementBar.
- TrustStrip.
- CTA editorial final.
- Medios de pago.
- Usuarios o roles.
- Configuración de envío.
- Acciones de órdenes desde la UI.

---

## 7. Qué parece editable pero no lo es

- Las métricas de About se guardan, pero `AboutSection` no renderiza `content.metrics`; muestra tres principios hardcodeados: [AdminAboutPage.tsx](C:/Users/mikelus/Desktop/PROYECTOS/Rehabex/src/admin/pages/AdminAboutPage.tsx:115), [AboutSection.tsx](C:/Users/mikelus/Desktop/PROYECTOS/Rehabex/src/components/AboutSection.tsx:13).
- El panel afirma que sin Supabase guarda contenido local, pero sin Supabase tampoco puede autenticar un usuario y `ProtectedRoute` redirige al login. Ese fallback es prácticamente inaccesible mediante la aplicación normal: [AuthProvider.tsx](C:/Users/mikelus/Desktop/PROYECTOS/Rehabex/src/auth/AuthProvider.tsx:36), [ProtectedRoute.tsx](C:/Users/mikelus/Desktop/PROYECTOS/Rehabex/src/auth/ProtectedRoute.tsx:23).
- “Guardar producto” sin Supabase devuelve un objeto temporal, pero después vuelve a cargar `defaultProducts`; no persiste en `localStorage`: [cms.ts](C:/Users/mikelus/Desktop/PROYECTOS/Rehabex/src/services/cms.ts:228).
- Los comentarios TODO que dicen conectar “Comprar” están desactualizados: ambos botones ya agregan al carrito: [StorePage.tsx](C:/Users/mikelus/Desktop/PROYECTOS/Rehabex/src/pages/StorePage.tsx:151), [ProductDetailPage.tsx](C:/Users/mikelus/Desktop/PROYECTOS/Rehabex/src/pages/ProductDetailPage.tsx:120).
- `primary_image_url`, SKU, slug y `product_images` existen en base, pero el panel no los usa.

---

## 8. Arquitectura actual

```text
Visitante / administrador
├─ React SPA
│  ├─ Supabase Auth con anon key
│  ├─ SELECT público de products/settings
│  ├─ INSERT/UPDATE/DELETE admin directos, controlados por RLS
│  ├─ carrito y snapshots en localStorage/sessionStorage
│  └─ upload unsigned directo a Cloudinary
│
├─ /api/orders
│  └─ token → getUser → profiles.role → service_role → lectura de órdenes
│
└─ /api/checkout / webhook / recovery / reconcile
   └─ validación → service_role → RPC transaccional → PostgreSQL
                                      └─ Mercado Pago
```

La frontera comercial de checkout es sólida y servidor/autoritativa. La frontera del CMS es más simple: escrituras directas desde el navegador con RLS, pero sin una capa central de validación, auditoría o concurrencia.

---

## 9. Panel administrativo existente

Ruta y protección: `/admin`, envuelta en `ProtectedRoute requireAdmin`: [App.tsx](C:/Users/mikelus/Desktop/PROYECTOS/Rehabex/src/App.tsx:34). Navegación: [AdminLayout.tsx](C:/Users/mikelus/Desktop/PROYECTOS/Rehabex/src/admin/components/AdminLayout.tsx:6).

| Módulo | Ruta | Lee datos | Escribe datos | Fuente | Protección | Estado real |
|---|---|---:|---:|---|---|---|
| Inicio | `/admin` | No | No | Constantes React | Ruta React | Informativo |
| Hero | `/admin/hero` | Sí | Sí | `settings.hero_content`; Cloudinary | Ruta + RLS | Real, sin validación estructural |
| Sobre nosotros | `/admin/quienes-somos` | Sí | Sí | `settings.about_content`; Cloudinary | Ruta + RLS | Parcial; métricas no se renderizan |
| Productos | `/admin/productos` | Sí | Sí | `products`; Cloudinary | Ruta + RLS | CRUD real pero incompleto |
| Ventas | `/admin/ordenes` | Sí | No | `/api/orders` → `orders/order_items` | Ruta + token + rol servidor | Lectura real |
| Reconciliación | Sin pantalla | Sí | Sí | MP + RPC atómica | Token + rol + CORS + rate limit | Endpoint real no conectado a UI |
| Upload | Dentro de formularios | No | Sí | Cloudinary | Sólo ocultamiento/ruta antes del proveedor | Real, pero unsigned |

Productos: [AdminProductsPage.tsx](C:/Users/mikelus/Desktop/PROYECTOS/Rehabex/src/admin/pages/AdminProductsPage.tsx:80). Órdenes: [OrdersTable.tsx](C:/Users/mikelus/Desktop/PROYECTOS/Rehabex/src/admin/components/OrdersTable.tsx:41). Autorización del endpoint: [orders.ts](C:/Users/mikelus/Desktop/PROYECTOS/Rehabex/api/orders.ts:42), [reconcile-payment.ts](C:/Users/mikelus/Desktop/PROYECTOS/Rehabex/api/admin/reconcile-payment.ts:142).

Dependencias del panel: React, React Router, Supabase JS y `fetch` a Cloudinary/API. No usa biblioteca de formularios, validación de esquemas, data grid ni query cache.

Duplicación relevante: Hero y About repiten carga, estados `saving/message/error`, cancelación y submit. La abstracción existente cubre campos y acciones visuales, no el ciclo de datos.

---

## 10. Mapa de fuentes de datos

| Contenido | Fuente actual | Archivo/tabla | Editable hoy | Hardcodeado | Fallback | Recomendación |
|---|---|---|---:|---:|---|---|
| Home | Composición React | `LandingPage` | Parcial | Sí | Sí | CMS limitado por sección |
| Tienda | Supabase | `products` | Sí | No en producción | `defaultProducts` sólo sin config | Eliminar fallback comercial |
| Detalle | Supabase por UUID | `products` | Sí | No | Producto fallback sin config | Usar slug publicado |
| Carrito | Valor derivado | `localStorage` | Usuario | No | Migración legacy | Mantener sólo como presentación |
| Navbar | Constante TS + auth/cart | `navigation.ts` | No | Sí | No | Mantener layout; enlaces comerciales opcionales en CMS |
| Hero | `settings` JSONB | `hero_content` | Sí | Parcial | `defaultLandingContent` | Documento validado y versionado |
| Destacados | Supabase + derivación cliente | `is_featured`, `display_order` | Sí | No | Productos fallback en Home | Resolver/paginar desde fuente única |
| About | `settings` + texto React | `about_content`, `AboutSection` | Parcial | Sí | Default TS | Administrar sólo copy e imagen |
| Galería editorial | About + primeras imágenes de productos | `getGalleryItems()` | Indirecto | Alt/labels parciales | Productos fallback | Tabla ordenada de galería |
| AnnouncementBar | Constante TS | `AnnouncementBar.tsx` | No | Sí | No | Mensajes CMS con máximo y vigencia opcional |
| TrustStrip | Constante TS | `TrustStrip.tsx` | No | Sí | No | Mantener en código salvo copy |
| CTA catálogo | Constante TS | `CatalogCtaSection.tsx` | No | Sí | No | Copy/label editables; layout en código |
| Footer | Constantes + categorías derivadas | `SiteFooter` | No | Sí | No | Contacto/redes en CMS; marca/layout en código |
| Contacto | Sólo ancla de footer | `#contacto` | No | Sí | No | Datos reales tipados |
| Redes sociales | Ausentes | — | No | No | No | No publicar hasta decisión comercial |
| Medios de pago | Array TS + assets locales | `PaymentMethods` | No | Sí | No | Mantener controlado en código/config comercial |
| Admin | Supabase/API | `src/admin` | Según módulo | Parcial | Defaults locales | Capa administrativa validada |
| Envío | `settings` JSONB | `commerce_shipping` | No desde UI | No | Cero seguro | Operación separada y auditada |

Evidencia: [LandingPage.tsx](C:/Users/mikelus/Desktop/PROYECTOS/Rehabex/src/pages/LandingPage.tsx:12), [AnnouncementBar.tsx](C:/Users/mikelus/Desktop/PROYECTOS/Rehabex/src/components/AnnouncementBar.tsx:11), [SiteFooter.tsx](C:/Users/mikelus/Desktop/PROYECTOS/Rehabex/src/components/SiteFooter.tsx:12), [PaymentMethods.tsx](C:/Users/mikelus/Desktop/PROYECTOS/Rehabex/src/components/PaymentMethods.tsx:16).

No hay enlaces actuales de Instagram, WhatsApp, email o teléfono en `src/`.

---

## 11. Flujo completo de productos

```text
public.products
→ cms.getProducts/getActiveProducts/getProductById
→ mapProductRow
→ Home / Tienda / Detalle
→ CartItem en localStorage
→ checkoutItemsForRequest: productId + quantity
→ /api/checkout
→ create_checkout_order_v2
→ create_checkout_order
→ locks + precio/stock desde PostgreSQL
→ order_items snapshot + stock_reservations
→ Mercado Pago
→ process_mercadopago_payment_atomic
→ stock_on_hand + inventory_movements
```

Evidencia de normalización: [cms.ts](C:/Users/mikelus/Desktop/PROYECTOS/Rehabex/src/services/cms.ts:109). Carrito: [cartState.ts](C:/Users/mikelus/Desktop/PROYECTOS/Rehabex/src/cart/cartState.ts:5). El navegador envía sólo UUID y cantidad: [checkoutService.ts](C:/Users/mikelus/Desktop/PROYECTOS/Rehabex/src/services/checkoutService.ts:50). El endpoint vuelve a validar el DTO: [checkout.ts](C:/Users/mikelus/Desktop/PROYECTOS/Rehabex/api/checkout.ts:237).

### Campos

| Campo | Existe en DB | Se usa públicamente | Editable en panel |
|---|---:|---:|---:|
| Nombre | Sí | Sí | Sí |
| ID UUID | Sí | Ruta actual | No |
| Slug | Sí, único si no nulo | No | No |
| SKU | Sí, único si no nulo | Checkout snapshot | No |
| Descripción | Sí | Sí | Sí |
| Precio | Sí | Sí | Sí |
| Stock | Sí | Sí | No |
| Activo | Sí | Sí | Sí |
| Estado editorial | No | — | No |
| Destacado | Sí | Sí | Sí |
| Orden | Sí | Sí | Sí |
| `image_url` | Sí | Sí | Sí |
| `primary_image_url` | Sí | Sólo checkout histórico | No |
| Galería | Tabla existente | No | No |
| Alt | En `product_images` | No | No |
| Categoría | Texto libre | Sí | Sí |
| SEO | No | No | No |

La ruta pública usa UUID, no slug: [App.tsx](C:/Users/mikelus/Desktop/PROYECTOS/Rehabex/src/App.tsx:29).

### Productos TEST

La Home excluye categorías `test` y `prueba`: [catalog.ts](C:/Users/mikelus/Desktop/PROYECTOS/Rehabex/src/lib/catalog.ts:1), [LandingPage.tsx](C:/Users/mikelus/Desktop/PROYECTOS/Rehabex/src/pages/LandingPage.tsx:14).

La Tienda no aplica el filtro: [StorePage.tsx](C:/Users/mikelus/Desktop/PROYECTOS/Rehabex/src/pages/StorePage.tsx:22). Por tanto, los 3 productos TEST activos detectados son públicamente navegables y potencialmente comprables si tienen stock.

### Precio, stock y orden histórica

- El precio del carrito es sólo presentación.
- PostgreSQL vuelve a leer y bloquear el producto, comprueba activo, precio y moneda: [202609110103…sql](C:/Users/mikelus/Desktop/PROYECTOS/Rehabex/supabase/migrations/202609110103_orders_commerce_foundation.sql:571).
- `order_items` copia SKU, nombre, imagen, precio y cantidad: [202609110103…sql](C:/Users/mikelus/Desktop/PROYECTOS/Rehabex/supabase/migrations/202609110103_orders_commerce_foundation.sql:607).
- Editar posteriormente el producto no altera una orden histórica.

---

## 12. Esquema de productos, categorías y comercio

El historial remoto confirma que las migraciones `101–106`, `108–110` están aplicadas.

### Tablas relevantes

| Tabla | Modelo principal | Integridad, índices y RLS |
|---|---|---|
| `profiles` | `id`, `role`, email, nombre, teléfono, timestamps | PK/FK a `auth.users`; rol `admin/user/customer`; lectura propia/admin; sin escritura cliente |
| `products` | Contenido, precio, imagen, SKU, slug, flags, inventario, timestamps | Precio > 0; stock/umbral ≥ 0; ARS; SKU/slug únicos parciales; lectura activa pública; admin CRUD |
| `settings` | `key`, `value jsonb`, `updated_at` | PK por key; lectura pública sólo Hero/About; admin CRUD |
| `product_images` | Producto, URL, alt, orden, primaria | FK cascade; una primaria; orden único; pública sólo si producto activo |
| `orders` | Datos de cliente, importes, estados, MP, revisión, entorno | Idempotencia, totales, referencias y entorno; lectura propia/admin |
| `order_items` | Snapshot histórico de producto y precio | FK order cascade; producto `SET NULL`; checks de precio/cantidad/total |
| `stock_reservations` | Orden, producto, cantidad, estado, vencimiento | Producto `RESTRICT`; reserva única por orden/producto |
| `inventory_movements` | Delta, tipo, motivo, orden, reserva, autor | Producto `RESTRICT`; movimiento de venta único |
| `payment_events` | Dedupe, estado proveedor, hashes y resultado | Sólo backend/service role |
| `commerce_rate_limit_windows` | Scope, hash, ventana, contador | Sólo operaciones internas |

Base inicial: [remote_public_schema.sql](C:/Users/mikelus/Desktop/PROYECTOS/Rehabex/supabase/baseline/20260911_remote_public_schema.sql:59). Extensión de productos/perfiles: [202609110102…sql](C:/Users/mikelus/Desktop/PROYECTOS/Rehabex/supabase/migrations/202609110102_profiles_products_foundation.sql:17). Comercio: [202609110103…sql](C:/Users/mikelus/Desktop/PROYECTOS/Rehabex/supabase/migrations/202609110103_orders_commerce_foundation.sql:197).

No existe tabla `categories`; `products.category` es texto libre. Tampoco existen tablas específicas de auditoría administrativa o configuración tipada del sitio.

### Capacidades del modelo de producto

| Capacidad | Estado |
|---|---|
| Borrador | Falta |
| Publicado | `is_active` actúa como sustituto insuficiente |
| Archivado | Falta |
| Activo/inactivo | Existe |
| Sin stock | Existe |
| Destacado | Existe |
| Orden manual | Existe |
| Varias imágenes | Modelo existe, integración no |
| Imagen principal | Duplicada entre dos columnas y `product_images` |
| Texto alternativo | Existe sólo en `product_images` |
| Slug único | Existe, pero nullable/no usado |
| SKU único | Existe, pero nullable |
| Precio válido | Check `price > 0`; constraint originalmente `NOT VALID` para histórico |
| Eliminación lógica | Falta |
| `created_at` | Existe |
| `updated_at` | Existe con trigger |
| `updated_by` | Falta |

El enum `profile_role` existe, pero `profiles.role` continúa siendo `text` con check; es deuda de esquema: [202609110102…sql](C:/Users/mikelus/Desktop/PROYECTOS/Rehabex/supabase/migrations/202609110102_profiles_products_foundation.sql:3).

### Funciones/RPC principales

- `is_admin`.
- `create_checkout_order` y wrapper `create_checkout_order_v2`.
- `get_checkout_shipping_amount`.
- Reserva/consumo/liberación de inventario.
- Leases de preferencia de Mercado Pago.
- Rate limiting.
- `process_mercadopago_payment_atomic`.
- Recuperación y expiración de reservas.
- Trigger de entorno de pago inmutable.

La migración `107`, que elimina dos RPC legacy, sigue deliberadamente pendiente: [pending_migrations/README.md](C:/Users/mikelus/Desktop/PROYECTOS/Rehabex/supabase/pending_migrations/README.md:3).

No hay vistas de aplicación.

---

## 13. Seguridad, roles y RLS

### Cómo se determina un administrador

El rol se guarda en `public.profiles.role`. El frontend lee el perfil del usuario autenticado y considera admin exclusivamente a `role === 'admin'`: [AuthProvider.tsx](C:/Users/mikelus/Desktop/PROYECTOS/Rehabex/src/auth/AuthProvider.tsx:100).

`public.is_admin()` vuelve a resolver `auth.uid()` contra `profiles`, es `SECURITY DEFINER`, usa `search_path = ''` y sólo puede ejecutarse por authenticated/service role: [202609110101…sql](C:/Users/mikelus/Desktop/PROYECTOS/Rehabex/supabase/migrations/202609110101_harden_existing_permissions.sql:3).

### Cinco niveles de protección

1. **Ocultar menú:** `SiteHeader` muestra Admin sólo si `isAdmin`. Es UX, no seguridad.
2. **Ruta React:** `ProtectedRoute` redirige usuarios no admin. Sigue siendo UX.
3. **Lectura:** RLS controla productos, perfiles, settings, órdenes e inventario.
4. **Escritura:** RLS `is_admin()` protege products/settings/product_images.
5. **Operación privilegiada:** endpoints y RPC comerciales usan validación servidor y `service_role`.

### Evaluación

- Un usuario no puede modificar su propio rol: no tiene grant ni policy de escritura sobre `profiles`.
- La clave `service_role` sólo aparece como `process.env`, nunca con prefijo `VITE_`: [commerce.ts](C:/Users/mikelus/Desktop/PROYECTOS/Rehabex/server/commerce/commerce.ts:150).
- `anon` sólo tiene SELECT sobre productos, settings y product_images; RLS limita filas.
- `authenticated` tiene ACL de mutación en productos/settings/imágenes, pero RLS permite sólo admin: [202609110104…sql](C:/Users/mikelus/Desktop/PROYECTOS/Rehabex/supabase/migrations/202609110104_harden_commerce_privileges.sql:27).
- Órdenes no dependen sólo del frontend: `/api/orders` valida el JWT y vuelve a consultar `profiles.role`.
- La reconciliación valida CORS, cuerpo, token, rol y rate limit antes de consultar Mercado Pago: [reconcile-payment.ts](C:/Users/mikelus/Desktop/PROYECTOS/Rehabex/api/admin/reconcile-payment.ts:50).

No encontré un bypass estático que permita a un usuario normal convertirse en admin o escribir productos.

### Hallazgo importante

`AuthProvider` imprime el objeto completo de sesión y resultados de perfil en consola: [AuthProvider.tsx](C:/Users/mikelus/Desktop/PROYECTOS/Rehabex/src/auth/AuthProvider.tsx:48). El objeto de sesión contiene material de autenticación. Severidad: alta.

---

## 14. Imágenes y almacenamiento

### Estado actual

- Cloudinary aloja las imágenes productivas observadas.
- El navegador usa un `upload_preset` y realiza directamente un upload unsigned: [cloudinary.ts](C:/Users/mikelus/Desktop/PROYECTOS/Rehabex/src/services/cloudinary.ts:6).
- `ImageField` acepta indistintamente una URL arbitraria o cualquier archivo con `accept="image/*"`: [ImageField.tsx](C:/Users/mikelus/Desktop/PROYECTOS/Rehabex/src/admin/components/ImageField.tsx:19).
- No hay validación de magic bytes, peso, dimensiones, formato o dominio.
- No se guarda `public_id`, ancho, alto, bytes, formato o autor.
- No existe eliminación Cloudinary; reemplazar una URL puede dejar el archivo anterior huérfano.
- La eliminación de producto no elimina archivos Cloudinary.
- La aplicación no sabe si una imagen es compartida antes de reemplazarla o intentar eliminarla.
- El upload no tiene una frontera de autorización propia en Cloudinary: quien obtenga cloud name y preset públicos puede intentar usar el preset directamente.
- `product_images` soporta orden, principal y alt, pero está vacío y no está integrado.

### Responsive

`HeroSection`, `ProductCard`, About y `EditorialSplit` insertan transformaciones y `srcset` sólo para Cloudinary: [image.ts](C:/Users/mikelus/Desktop/PROYECTOS/Rehabex/src/lib/image.ts:5).

`StorePage` y `ProductDetailPage` usan la URL cruda, sin `srcset` ni transformación.

### Comparación

| Criterio | Supabase Storage | Cloudinary |
|---|---|---|
| Integración actual | Ninguna | Sí |
| Datos productivos observados | No verificados | Sí |
| Políticas versionadas | No hay buckets/policies de app en migraciones | No aplica RLS; preset actual controla upload |
| Upload seguro futuro | Endpoint o policy Storage estricta | Upload firmado desde backend |
| Transformaciones/CDN | Disponibles según plan | Ya usadas por helpers actuales |
| Eliminación | API Storage + RLS | API Admin/Destroy desde servidor |
| Riesgo actual | Estado remoto desconocido | Upload unsigned y huérfanos |
| Migración necesaria | Alta | Moderada |

La configuración local de Storage sólo habilita el servicio y fija un límite genérico de 50 MiB; no define buckets: [config.toml](C:/Users/mikelus/Desktop/PROYECTOS/Rehabex/supabase/config.toml:114).

### Estrategia recomendada

Usar **Cloudinary como única estrategia principal**, porque ya aloja los activos productivos y el frontend ya implementa sus transformaciones.

Arquitectura futura:

- Upload firmado mediante `/api/admin/media/sign` o endpoint equivalente.
- JWT y rol admin validados en servidor.
- Allowlist de JPEG, PNG, WebP y, si se decide, AVIF.
- Validación por magic bytes, no sólo extensión/MIME declarado.
- Peso máximo y límites mínimo/máximo de dimensiones.
- Transformación canónica y variantes responsive.
- Tabla `media_assets`: `id`, `provider`, `public_id`, URL, formato, MIME, bytes, ancho, alto, focal point, autor y timestamps.
- `product_images` referenciando `media_asset_id`, con alt, orden y principal.
- Reemplazo en dos fases: subir → validar/persistir → cambiar referencia → marcar anterior como candidata a limpieza.
- Eliminación servidor sólo cuando no existan referencias.
- Job de limpieza de huérfanos con período de gracia.
- No permitir URLs arbitrarias después de migrar activos existentes.

---

## 15. Stock e inventario

### Flujo actual

1. Checkout bloquea el producto y calcula disponibilidad como `stock_on_hand - reservas activas`.
2. Inserta `order_items` y `stock_reservations`.
3. Pago pendiente mantiene la reserva.
4. Pago aprobado ejecuta preflight de todas las líneas bajo locks.
5. Sólo si toda la orden es cumplible descuenta `stock_on_hand`.
6. Inserta movimientos `sale`.
7. Rechazo o cancelación libera reservas.
8. Vencimiento marca reservas y órdenes expiradas.
9. Aprobación tardía sin stock pasa a `on_hold` y `refund_required`.
10. Refund/chargeback no repone stock automáticamente.

Checkout/reservas: [202609110103…sql](C:/Users/mikelus/Desktop/PROYECTOS/Rehabex/supabase/migrations/202609110103_orders_commerce_foundation.sql:562). Procesamiento final atómico: [202609110110…sql](C:/Users/mikelus/Desktop/PROYECTOS/Rehabex/supabase/migrations/202609110110_order_payment_environment.sql:243). Expiración: [202609110108…sql](C:/Users/mikelus/Desktop/PROYECTOS/Rehabex/supabase/migrations/202609110108_payment_recovery_and_hold_expiry.sql:66).

### ¿Puede el panel editar directamente `stock_on_hand`?

No debería.

Aunque el panel actual no expone el campo, un admin tiene capacidad RLS para actualizar la fila de producto directamente. Una actualización directa:

- No crea `inventory_movements`.
- No registra cantidad anterior.
- No registra motivo o referencia.
- Puede interferir con reservas activas y disponibilidad calculada.
- No ofrece control optimista ni reglas operativas.

La futura edición debe ser una RPC transaccional, por ejemplo `adjust_inventory`:

- Bloquear producto.
- Validar delta o cantidad final.
- Rechazar stock negativo.
- Conservar `before_quantity`, `quantity_delta`, `after_quantity`.
- Exigir motivo.
- Registrar `created_by`.
- Admitir referencia externa opcional.
- Actualizar producto e insertar movimiento en la misma transacción.
- Mantener el historial inmutable.

`inventory_movements` ya contiene gran parte de la base requerida: [202609110103…sql](C:/Users/mikelus/Desktop/PROYECTOS/Rehabex/supabase/migrations/202609110103_orders_commerce_foundation.sql:256).

---

## 16. CMS de la Home

### Administrable recomendado

- Hero: título, subtítulo, imagen y CTA.
- About: título, descripción e imagen.
- Galería editorial ordenada.
- Mensajes limitados de AnnouncementBar.
- CTA de catálogo: copy y etiqueta.
- Contacto.
- Instagram y WhatsApp cuando existan datos aprobados.
- Un conjunto limitado de productos destacados mediante el catálogo.

### Debe permanecer en código

- Paleta, tipografía, espaciado y breakpoints.
- Layout y composición de secciones.
- Animaciones.
- Componentes.
- Accesibilidad.
- Reglas de seguridad.
- Checkout/Mercado Pago.
- Reglas de inventario.
- Cantidad máxima y estructura permitida de los bloques.

### Opciones

| Opción | Ventaja | Problema |
|---|---|---|
| Una tabla `site_settings` | Simple; ya existe como `settings` | JSON sin validación ni relaciones |
| Tablas por sección | Integridad fuerte | Excesivo para cada singleton |
| Un gran JSON | Pocos objetos | Difícil de versionar, validar e invalidar |
| Híbrida | Proporcional y extensible | Requiere contratos claros |

### Recomendación

Estrategia híbrida:

- Reutilizar `settings` o renombrarla en una migración controlada para documentos singleton: Hero, About, Announcement y Contact.
- Cada documento debe tener esquema/versionado y guardarse mediante RPC o endpoint allowlisted.
- Usar tablas relacionales para elementos repetibles o referenciados:
  - `media_assets`.
  - `home_gallery_items`.
  - Productos/categorías/destacados en el catálogo.
- Validación TypeScript compartida + validación servidor + constraints mínimas en DB.
- No construir un page builder.

---

## 17. CRUD administrativo objetivo

### Listado mínimo

- Consulta paginada desde DB.
- Búsqueda por nombre, SKU y slug.
- Filtros por estado, categoría, stock y destacado.
- Orden por actualizado, nombre, precio y orden visual.
- Estados de loading, vacío y error.
- Selección sensible sólo donde sea necesaria.
- Sin cargar todo el catálogo en memoria.

### Primera versión

Incluir:

- Nombre.
- Slug.
- SKU.
- Descripción.
- Categoría existente.
- Precio.
- Estado `draft/published/archived`.
- Destacado.
- Orden.
- Vista de imagen principal actual.
- Stock sólo lectura.
- `updated_at`/versión para concurrencia.

En ADMIN-03:

- Imagen principal.
- Galería.
- Alt.
- Reordenamiento.
- Recorte/focal point.

Puede esperar:

- Descripción corta separada.
- Rich text.
- SEO avanzado.
- Programación.
- Variantes.
- Multi-moneda.
- Múltiples depósitos.
- Reversiones completas.
- Localización.

### Acciones sensibles

- **Publicar:** operación servidor/RPC; exige nombre, precio, SKU/slug únicos, categoría válida e imagen principal.
- **Despublicar:** pasa a draft, sin borrar.
- **Archivar:** estado reversible; no aparece públicamente.
- **Eliminar:** no ofrecer inicialmente. Un purge posterior debe exigir que no haya referencias operativas.
- **Cambiar precio:** operación auditada con valor anterior/nuevo.
- **Ajustar stock:** sólo RPC de inventario.
- **Reemplazar imagen:** transición segura y limpieza diferida.
- **Cambiar slug:** registrar alias/redirección cuando las rutas públicas usen slug.

Crear producto activo con el panel actual produce, por defecto, un producto publicado inmediatamente pero con `stock_on_hand = 0`, SKU/slug nulos y sin flujo editorial. Esto debe dejar de ser posible.

---

## 18. Publicación y trazabilidad

Mínimo razonable para pocas personas:

- `status`: `draft | published | archived`.
- `published_at`, `archived_at`.
- `created_by`, `updated_by`.
- `version` o comparación de `updated_at`.
- Vista previa autenticada de borradores.
- Registro append-only de cambios relevantes.
- Restaurar archivado a borrador.
- Sin programación en primera versión.
- Sin árbol empresarial de revisiones.

El catálogo público sólo debe poder leer `published`; RLS debe impedir que un visitante descubra borradores.

---

## 19. Cache y actualización pública

No hay React Query, SWR, service worker, caché propia ni datos de catálogo embebidos en build.

Las páginas hacen fetch directo en `useEffect`. Consecuencias:

- Un cambio aparece al montar nuevamente la pantalla o refrescar.
- No requiere redeploy si está en Supabase.
- Una página ya montada conserva datos viejos.
- No hay invalidación cross-tab ni realtime.
- Stock visible puede quedar desactualizado; checkout lo recalcula correctamente.
- Copy hardcodeado, marca, payment assets y layout sí requieren build/deploy.
- Cloudinary puede conservar una imagen si se sobrescribe la misma URL.

Evidencia: [useLandingData.ts](C:/Users/mikelus/Desktop/PROYECTOS/Rehabex/src/hooks/useLandingData.ts:23), [StorePage.tsx](C:/Users/mikelus/Desktop/PROYECTOS/Rehabex/src/pages/StorePage.tsx:29).

Invalidación futura:

| Recurso | Estrategia |
|---|---|
| Producto | Invalidar detalle, lista, Home y búsqueda |
| Categoría | Invalidar catálogo, filtros y footer |
| Stock | Actualización corta o realtime; checkout siempre autoritativo |
| Home | Invalidar documento de sección |
| Imagen | URL versionada/nuevo public ID |
| Destacado | Invalidar Home y listado admin |

React Query sería proporcional para el panel y catálogo, con claves separadas y mutaciones que invaliden explícitamente. No es obligatorio introducir SSR/revalidación de build.

---

## 20. Validaciones

### Estado actual

- Formulario de producto: nombre requerido, precio mínimo 1, orden mínimo 0 y URL de imagen.
- Servicio: nombre no vacío, precio > 0 e imagen requerida.
- DB: precio > 0, stock/umbral no negativos, moneda ARS, SKU/slug únicos si existen.
- CMS Hero/About: sin longitudes, esquema servidor o validación de CTA.
- Imágenes: sólo `accept="image/*"`.
- Categoría: texto libre.
- Slug/SKU: no administrados.
- Checkout: DTO servidor estricto y constraints/RPC robustos.

### Objetivo por capa

| Regla | Formulario | Backend/RPC | Base de datos |
|---|---:|---:|---:|
| Precio positivo y máximo razonable | Sí | Sí | Sí |
| Stock entero no negativo | Sí | Sí | Sí |
| Slug kebab-case | Sí | Sí | Check |
| Slug/SKU únicos | Feedback | Sí | Índice único |
| Categoría válida | Selector | Sí | FK |
| Estado válido | Selector | Sí | Enum/check |
| Longitudes máximas | Sí | Sí | Check cuando aporte |
| Imagen principal al publicar | Sí | Sí | RPC de publicación |
| MIME real/peso/dimensiones | Feedback | Obligatorio | Metadata persistida |
| Alt | Sí | Sí | Requerido según contexto |
| CTA seguro | Sí | Allowlist `/#...`, rutas internas o HTTPS aprobado | Documento validado |
| Estado/publicación consistente | Sí | Obligatorio | RPC/constraints |

Las validaciones de formulario mejoran UX. Las de backend/RPC y DB garantizan seguridad e integridad.

---

## 21. Auditoría y trazabilidad actual

| Tipo | Estado |
|---|---|
| Logs técnicos | `logEvent` en comercio; consola en auth/CMS |
| Historial de producto | No existe |
| Movimientos de inventario | Existe para ventas; ajuste admin no implementado |
| Auditoría administrativa | No existe |
| Quién creó/editó producto | No |
| Precio anterior | No |
| Stock anterior | No en ajustes directos |
| Estado anterior | No |
| Imagen eliminada | No |
| Publicación/despublicación | No modelada |
| Settings `updated_by` | No |
| Settings `updated_at` fiable | No hay trigger equivalente visible |

Solución proporcional:

- `admin_audit_events`: actor, acción, entidad, entidad ID, request ID, before/after sanitizado y fecha.
- Mantener `inventory_movements` como registro especializado e inmutable.
- Mantener `payment_events` como registro técnico del proveedor.
- No mezclar logs técnicos con historial comercial.
- Guardar sólo campos necesarios; evitar tokens, direcciones completas o secretos en auditoría de catálogo.

---

## 22. Pruebas actuales y matriz futura

### Estado actual

Ejecutado en ADMIN-00:

- `test:api`: 76/76 casos aprobados.
- `test:cart`: 13/13 casos aprobados.

No se ejecutó `test:db:concurrency` porque crea y elimina filas; además, la suite se niega a usar URLs remotas: [paymentAtomicConcurrency.test.ts](C:/Users/mikelus/Desktop/PROYECTOS/Rehabex/tests/db/paymentAtomicConcurrency.test.ts:10).

Existen pruebas SQL locales de RLS, checkout, pagos e inventario en `supabase/tests/`, pero no pruebas del CRUD administrativo, upload, publicación o CMS.

### Matriz futura

| Área | Unitarias | Integración/API | DB/RLS local | E2E/preview |
|---|---:|---:|---:|---:|
| Roles/rutas | Sí | Sí | Sí | Sí |
| CRUD catálogo | Sí | Sí | Sí | Sí |
| Validaciones | Sí | Sí | Constraints | Sí |
| Publicar/archivar | Sí | Sí | Sí | Sí |
| Imágenes válidas/inválidas | Sí | Sí | Metadata | Sí |
| Stock/ajustes | Sí | Sí | Concurrencia | Smoke |
| Cache/invalidation | Sí | Sí | — | Sí |
| CMS Home | Sí | Sí | RLS | Sí |
| Accesibilidad | Componentes | — | — | Automatizada + manual |
| Responsive | — | — | — | Viewports representativos |
| Regresión catálogo | Sí | Sí | Sí | Sí |
| Regresión checkout | Ya existe | Ya existe | Ya existe | Sandbox |
| Órdenes | Presentación actual | API actual | RLS | Lectura smoke |

Producción no debe utilizarse para ninguna de estas pruebas.

---

## 23. Registro de riesgos

| ID | Hallazgo | Evidencia | Impacto | Prob. | Severidad | Recomendación |
|---|---|---|---|---|---|---|
| R-01 | Desarrollo local conectado a Supabase/Cloudinary productivos sin staging | Clasificación segura de `.env`; plan de staging | Escrituras accidentales reales | Alta | **Crítico** | ADMIN-01: staging y separación estricta |
| R-02 | 3 de 6 productos activos públicos son TEST | Consulta pública agregada; Tienda sin filtro | Compra/confusión de datos de prueba | Alta | **Alto** | Separar entorno y estado de publicación; no depender de categoría |
| R-03 | Sesión Supabase completa impresa en consola | `AuthProvider:48–54` | Exposición de tokens a consola/telemetría | Media | **Alto** | Retirar logs sensibles |
| R-04 | Cloudinary unsigned desde navegador y URL arbitraria | `cloudinary.ts`, `ImageField.tsx` | Abuso, archivos inválidos, costos y huérfanos | Alta | **Alto** | Upload firmado y registro de assets |
| R-05 | Home reemplaza error remoto con productos ficticios | `useLandingData:27–35` | Precios/catálogo falsos en producción | Media | **Alto** | Fail closed con estado de error |
| R-06 | Productos/settings se escriben directamente sin contrato servidor ni auditoría | `cms.ts:163–172, 228–301` | Cambios inválidos o no trazables | Media | **Alto** | Endpoints/RPC allowlisted |
| R-07 | Edición de stock sería posible fuera de movimientos | Grants admin + modelo productos | Ruptura de trazabilidad | Media | **Alto** | Revocar update sensible; RPC de ajuste |
| R-08 | Tres representaciones de imagen | `image_url`, `primary_image_url`, `product_images` | Divergencia y borrado inseguro | Alta | **Medio** | Migrar a assets + product_images |
| R-09 | Eliminación física desde un botón sin confirmación | `AdminProductsPage:103–121` | Pérdida o fallos por FK RESTRICT | Media | **Medio** | Archivar; purge excepcional |
| R-10 | JSON CMS y CTA sin validación | `cms.ts:125–172` | Contenido roto/destino inseguro | Media | **Medio** | Esquemas y allowlist |
| R-11 | Métricas editables no visibles | Admin About vs AboutSection | Falsa expectativa del cliente | Alta | **Medio** | Retirar campo o volverlo parte del CMS real |
| R-12 | Productos activos incompletos | 6 activos; sólo 3 con imagen/SKU/slug | Cards sin imagen y catálogo inconsistente | Alta | **Medio** | Reglas de publicación |
| R-13 | Sin invalidación de caché/estado | Fetch directo en mount | Contenido viejo en sesiones abiertas | Media | **Medio** | Query cache e invalidación |
| R-14 | Sin auditoría de precio/publicación/imagen | Esquema actual | Sin atribución ni recuperación | Alta | **Medio** | `admin_audit_events` |
| R-15 | Categorías libres | `products.category` | Duplicados y filtros inconsistentes | Alta | **Medio** | Tabla categories en ADMIN-04 |
| R-16 | TODO de carrito desactualizados | Store/Detail | Deuda y diagnóstico incorrecto | Alta | **Bajo** | Limpiar en fase autorizada |
| R-17 | `service_role` expuesta al frontend | No encontrada | — | Baja | **Sin hallazgo** | Mantener server-only |
| R-18 | Precio/stock confiados al navegador | No: se recalculan en RPC | — | Baja | **Control correcto** | Preservar arquitectura |

Ante R-01 no se intentó ninguna explotación ni prueba activa de escritura.

---

## 24. Arquitectura recomendada

```text
Administrador autenticado
→ API/RPC administrativa con JWT real
→ role verificado contra profiles
→ validación de esquema y concurrencia
→ operación transaccional específica
→ products/settings/media/inventory
→ auditoría append-only
→ invalidación de queries
→ tienda pública con RLS de publicación
```

### Decisiones técnicas

- **Fuente única de catálogo:** `products` + `categories` + `product_images/media_assets`.
- **Eliminar:** `defaultProducts` de rutas productivas. Conservar fixtures sólo para tests/dev explícito.
- **Roles:** empezar con `admin`; añadir `catalog_manager` sólo si existe una necesidad comercial.
- **Ruta React:** mantenerla para UX, nunca como frontera.
- **Escrituras:** revocar mutaciones directas genéricas y exponer operaciones estrechas.
- **Identidad en RPC:** preferentemente cliente Supabase user-scoped con JWT para que `auth.uid()` permanezca disponible.
- **Service role:** sólo para operaciones que realmente la necesitan, tras autorización servidor.
- **Precio:** update específico con auditoría.
- **Stock:** RPC transaccional de ajuste.
- **Imágenes:** Cloudinary firmado + `media_assets`.
- **Publicación:** `draft/published/archived`.
- **Cache:** React Query o equivalente con invalidación por recurso.
- **Auditoría:** tabla administrativa + movimientos de inventario especializados.
- **Recuperación:** archive/restore; reemplazo de imagen reversible; concurrencia optimista.
- **Separación:** catálogo y CMS deben tener contratos/tablas separados, aunque compartan media.

---

## 25. Roadmap ADMIN-01 a ADMIN-08

| Fase | Objetivo y dependencias | Complejidad / capas | Migraciones esperadas | Riesgos y pruebas | Aceptación / fuera de alcance |
|---|---|---|---|---|---|
| ADMIN-01 | Staging, roles, frontera admin, retirar logs sensibles y TEST públicos | Grande; env, auth, API, DB | Grants/RLS, RPC base, auditoría mínima | RLS/roles, separación de entornos | Ninguna escritura admin depende sólo de UI; no CRUD nuevo |
| ADMIN-02 | Catálogo: listado, crear/editar, publicar y archivar | Grande; UI/API/DB | `status`, timestamps editoriales, actor/versión, checks | CRUD, concurrencia, regresión checkout | Fuente única; stock sólo lectura; sin galería avanzada |
| ADMIN-03 | Media segura y galería | Grande; API Cloudinary, DB, UI | `media_assets`, FK en product_images | MIME falso, peso, huérfanos, permisos | Upload firmado, principal/alt/orden; sin edición multimedia avanzada |
| ADMIN-04 | Categorías y destacados | Mediana; DB/API/UI | `categories`, slug, FK/backfill, orden | Slugs/duplicados/RLS | Categorías normalizadas; sin taxonomía multinivel |
| ADMIN-05 | Ajustes trazables de inventario | Grande; RPC/DB/UI | Extender movements y RPC de ajuste | Concurrencia/reservas/no negativos | Ningún cambio directo de stock; sin múltiples depósitos |
| ADMIN-06 | CMS de Home limitado | Mediana; settings/media/UI | Versionado/validación CMS, galería/announcement/contact | CTA, RLS, cache | Hero/About/galería/anuncios/contacto editables; sin page builder |
| ADMIN-07 | Órdenes: lectura y búsqueda | Mediana; API/UI | Índices o vistas de lectura si hacen falta | Privacidad, paginación, estados | Buscar/filtrar/ver detalle; mutaciones fuera de alcance |
| ADMIN-08 | Métricas y operación | Mediana; consultas/API/UI | Vistas/RPC agregadas | Calidad y privacidad de datos | Métricas reproducibles; sin BI empresarial |

ADMIN-01 es la única siguiente fase recomendable. No debe comenzar sin aprobación.

---

## 26. Decisiones pendientes del propietario

- Quiénes serán administradores.
- Si se necesita un rol separado de catálogo.
- Política de alta/baja de administradores.
- Cloudinary definitivo y presupuesto/cuotas.
- Política de archivado y eliminación.
- Si se requieren borradores y vista previa.
- Si hace falta programación futura.
- Quién puede cambiar precios.
- Motivos permitidos para ajustes de stock.
- Política de devolución y reposición de inventario.
- Datos reales de WhatsApp.
- URL real de Instagram.
- Email, teléfono y dirección de contacto.
- Cobertura de envíos.
- Precio/regla de envío.
- Medios de pago que deben mostrarse comercialmente.
- Qué copy exacto de Home puede modificar el cliente.
- Si las métricas de About deben existir o retirarse.
- Cuántos destacados y elementos de galería se permiten.
- Si el slug público reemplazará a la ruta por UUID.

Ninguna decisión comercial pendiente debe convertirse automáticamente en contenido publicado.

---

## 27. Archivos y migraciones inspeccionados

Principales archivos:

- [App.tsx](C:/Users/mikelus/Desktop/PROYECTOS/Rehabex/src/App.tsx)
- [AuthProvider.tsx](C:/Users/mikelus/Desktop/PROYECTOS/Rehabex/src/auth/AuthProvider.tsx)
- [ProtectedRoute.tsx](C:/Users/mikelus/Desktop/PROYECTOS/Rehabex/src/auth/ProtectedRoute.tsx)
- [cms.ts](C:/Users/mikelus/Desktop/PROYECTOS/Rehabex/src/services/cms.ts)
- [cloudinary.ts](C:/Users/mikelus/Desktop/PROYECTOS/Rehabex/src/services/cloudinary.ts)
- [defaultContent.ts](C:/Users/mikelus/Desktop/PROYECTOS/Rehabex/src/lib/defaultContent.ts)
- [AdminProductsPage.tsx](C:/Users/mikelus/Desktop/PROYECTOS/Rehabex/src/admin/pages/AdminProductsPage.tsx)
- [AdminHeroPage.tsx](C:/Users/mikelus/Desktop/PROYECTOS/Rehabex/src/admin/pages/AdminHeroPage.tsx)
- [AdminAboutPage.tsx](C:/Users/mikelus/Desktop/PROYECTOS/Rehabex/src/admin/pages/AdminAboutPage.tsx)
- [OrdersTable.tsx](C:/Users/mikelus/Desktop/PROYECTOS/Rehabex/src/admin/components/OrdersTable.tsx)
- [checkout.ts](C:/Users/mikelus/Desktop/PROYECTOS/Rehabex/api/checkout.ts)
- [orders.ts](C:/Users/mikelus/Desktop/PROYECTOS/Rehabex/api/orders.ts)
- [reconcile-payment.ts](C:/Users/mikelus/Desktop/PROYECTOS/Rehabex/api/admin/reconcile-payment.ts)

SQL:

- Baseline remoto `20260911_remote_public_schema.sql`.
- Migraciones `202609110101` a `106`.
- Migraciones `202609110108` a `110`.
- Migración pendiente `107`.
- Rollbacks asociados.
- Cuatro suites SQL de RLS, checkout y concurrencia.

---

## 28. Comandos seguros ejecutados

- `git branch --show-current`
- `git rev-parse HEAD`
- `git status --short`
- Lecturas de `package.json`, estructura, fuentes, SQL y documentación.
- Búsquedas con `rg`.
- Clasificación de nombres/configuración de entorno sin imprimir valores.
- `npx supabase migration list --linked`, exclusivamente metadata.
- GET anónimo agregado de `products`, `settings` y `product_images`, sin nombres, contenido ni URLs completas.
- `npm run test:api`: 76 aprobadas.
- `npm run test:cart`: 13 aprobadas.

No se ejecutaron:

- `dev`, `build` o preview.
- `test:db:concurrency`.
- Migraciones, seeds, SQL remoto o RPC de mutación.
- Checkout o Mercado Pago.
- Upload o eliminación de imágenes.
- Login administrativo.
- Creación/edición/eliminación de productos.

---

## 29. Confirmaciones finales

- Cero escrituras remotas.
- Cero cambios de precio, stock, productos, usuarios, roles o imágenes.
- Cero pagos o checkouts iniciados.
- No se aplicaron migraciones.
- No se modificó frontend ni backend.
- No se creó administrador nuevo.
- No hubo merge, commit, push ni deployment.
- El árbol terminó limpio.
- ADMIN-01 no fue iniciada.

ADMIN-00 queda concluida con estas decisiones técnicas: Supabase debe ser la única fuente del catálogo, Cloudinary el proveedor principal de imágenes mediante upload firmado, precio y stock deben mutarse mediante operaciones protegidas y auditadas, el CMS debe ser híbrido y limitado, y ADMIN-01 debe resolver primero seguridad operativa, staging y fronteras de autorización.
