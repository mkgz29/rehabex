# Auditoria tecnica Rehabex - 2026-09

Fecha de auditoria: 2026-09-09
Repositorio auditado: `C:\Users\mikelus\Desktop\PROYECTOS\Rehabex`
Modo: auditoria solamente. No se modifico codigo fuente, no se instalaron dependencias, no se ejecutaron migraciones, seeds ni operaciones contra servicios externos.

> Nota historica: las referencias a `api/create-preference.ts` y
> `api/webhook.ts` describen el estado auditado el 2026-09-09. La etapa 3H
> retiro ambas rutas locales; las rutas vigentes se documentan en
> `MERCADOPAGO_CHECKOUT_LOCAL.md`.

## Resumen ejecutivo

Rehabex es una SPA de e-commerce desarrollada con React, Vite, TypeScript, Tailwind, Supabase y funciones serverless en `api/` para Mercado Pago y consulta de ordenes. El frontend publico tiene landing, tienda, detalle de producto, carrito, auth y paginas de resultado de pago. El panel administrativo permite editar hero, about, productos y consultar ventas.

El proyecto compila para produccion y `npm audit --omit=dev` no reporto vulnerabilidades conocidas. Sin embargo, no esta preparado para produccion comercial: faltan piezas criticas de seguridad, trazabilidad de ordenes, stock, checkout, validacion de webhooks, schema versionado, RLS verificable, testing y configuracion robusta de despliegue.

Veredicto: **no apto para produccion sin una etapa previa de hardening funcional, seguridad y persistencia**. Si el objetivo inmediato es un redisenio visual, conviene conservar servicios, providers y rutas como base, pero aislar mejor la logica de datos antes de rehacer UI para no romper checkout, auth y admin.

## Hechos comprobados

- Git estaba limpio antes de auditar: `git status --short --branch` devolvio `## main...origin/main`.
- `node_modules` ya existia, por lo que no se instalo nada.
- Existe `.env` local en la raiz, pero no se leyo su contenido.
- `docs/` no existia; se creo solo para este informe.
- Hay 53 archivos en `src/` y `api/`.
- No se encontraron archivos `.sql`, migraciones Supabase ni schema versionado. La unica coincidencia Supabase fuera de codigo es `src/lib/supabase.ts`.

## Stack real encontrado

Declarado en `package.json`:

- Vite: script `build` ejecuta `tsc -b && vite build` (`package.json:6-9`).
- React `^18.3.1`, React DOM `^18.3.1`, React Router DOM `^7.14.1` (`package.json:14-16`).
- Supabase JS `^2.103.3` y Mercado Pago `^2.12.0` (`package.json:12-13`).
- TypeScript `^5.6.3`, Tailwind `^3.4.17`, Vite `^5.4.10` (`package.json:25-27`).

Versiones resueltas/locales observadas con `npm ls --depth=0`:

- Node local: `v22.18.0`.
- npm local: `10.9.3`.
- `@supabase/supabase-js@2.103.3`, `mercadopago@2.12.0`, `react@18.3.1`, `react-router-dom@7.14.1`, `typescript@5.9.3`, `vite@5.4.21`, `tailwindcss@3.4.19`.

Riesgo de runtime: `@supabase/supabase-js` y `react-router-dom` resueltos declaran `node >=20.0.0` en `package-lock.json`. El proyecto no declara `engines` ni `packageManager` en `package.json`; produccion deberia fijar Node >=20.

## Mapa de arquitectura

Frontend:

- Entry point: `src/main.tsx` monta `BrowserRouter`, `AuthProvider` y `CartProvider`.
- Rutas: `src/App.tsx` define `/`, `/login`, `/registro`, `/tienda`, `/productos/:id`, `/carrito`, `/success`, `/failure`, `/pending` y `/admin/*`.
- Layout publico: `src/components/AppLayout.tsx` + `Navbar`.
- Paginas publicas: `src/pages/*`.
- Admin: `src/admin/pages/*` y `src/admin/components/*`.
- Estado global: `src/auth/AuthProvider.tsx` y `src/cart/CartProvider.tsx`.
- Servicios: `src/services/cms.ts`, `src/services/checkoutService.ts`, `src/services/cloudinary.ts`.
- Tipos CMS: `src/types/cms.ts`.

Backend/serverless:

- `api/create-preference.ts`: crea preferencia Mercado Pago validando productos activos contra Supabase.
- `api/webhook.ts`: recibe webhook Mercado Pago, consulta el pago y hace `upsert` en `orders`.
- `api/orders.ts`: consulta ordenes usando service role y valida token Bearer + role admin.

Persistencia inferida:

- Tablas esperadas por codigo: `settings`, `products`, `profiles`, `orders`.
- Columnas esperadas: `products.id/name/description/category/price/image_url/is_featured/display_order/is_active/created_at`, `profiles.role`, `orders.payment_id/status/amount/currency/payment_method_id/payment_type_id/payer_email/payer_id/items/metadata/external_reference`.
- No hay schema, migraciones ni politicas RLS versionadas en el repo.

Despliegue:

- `vercel.json` solo tiene rewrite SPA hacia `/index.html` (`vercel.json:2-5`).
- No se declara configuracion de funciones, regiones, headers de seguridad, runtime Node ni variables requeridas para Vercel.

## Funcionalidades encontradas

- Landing editable con hero, productos destacados, about, footer y WhatsApp.
- Tienda con listado de productos activos desde Supabase o fallback local.
- Detalle de producto por id.
- Carrito persistido en `localStorage`.
- Checkout basico con Mercado Pago mediante `/api/create-preference`.
- Paginas de resultado de pago.
- Auth con Supabase email/password.
- Ruta admin protegida por perfil `role = admin`.
- Panel admin para hero, about, productos y ventas.
- Upload de imagenes a Cloudinary desde navegador cuando hay variables `VITE_CLOUDINARY_*`.

## Estado de cada flujo

| Flujo | Estado | Evidencia | Comentario |
| --- | --- | --- | --- |
| Home/landing | Parcialmente funcional | `src/pages/LandingPage.tsx:9-21` | Carga contenido y destacados, pero sin loading/error visible; fallback oculta fallas. |
| Navbar | Funcional con detalles UX | `src/components/Navbar.tsx:85-207` | Responsive basico, carrito/auth/admin; tiene mojibake en textos de sesion. |
| Footer/contacto | Basico | `src/components/Footer.tsx:1-19` | Email/telefono hardcodeados; copyright con mojibake. |
| WhatsApp | Basico | `src/components/WhatsAppFloatingButton.tsx:1-17` | Numero hardcodeado de placeholder. |
| Tienda | Parcial | `src/pages/StorePage.tsx:18-89` | Loading/error/empty presentes; no hay busqueda, filtros ni paginacion. |
| Detalle producto | Parcial | `src/pages/ProductDetailPage.tsx:17-137` | Carga por id, permite carrito; no valida stock ni producto activo en detalle. |
| Carrito | Parcial | `src/cart/CartProvider.tsx:39-166`, `src/pages/CartPage.tsx:14-143` | Persistencia local y cantidades; no sincroniza precios/stock hasta checkout. |
| Checkout | Riesgoso/incompleto | `api/create-preference.ts:72-113`, `api/create-preference.ts:190` | No crea orden previa, no reserva stock, no hay usuario/envio/contacto. |
| Resultado de pago | Informativo solamente | `src/hooks/usePaymentResult.ts:10-21` | Confia en query params; no verifica estado real de la orden. |
| Webhook | Alto riesgo | `api/webhook.ts:55-139` | No valida firma/origen ni idempotencia completa de negocio; siempre responde 200. |
| Admin auth | Parcial | `src/auth/ProtectedRoute.tsx:23-31`, `api/orders.ts:44-57` | UI protege por profile; seguridad real depende de RLS y roles externos. |
| Admin productos | Parcial | `src/admin/pages/AdminProductsPage.tsx:89-121`, `src/services/cms.ts:244-300` | CRUD directo a Supabase; sin confirmacion de delete ni auditoria. |
| Admin ventas | Parcial | `src/admin/components/OrdersTable.tsx:29-80`, `api/orders.ts:65-74` | Lista ordenes si hay service role y admin; no hay detalle ni acciones. |
| Upload imagenes | Riesgoso | `src/services/cloudinary.ts:1-22`, `src/admin/components/ImageField.tsx:21-37` | Upload unsigned desde cliente; requiere preset restringido. |

## Hallazgos

### Critica - Webhook de Mercado Pago sin validacion de firma

Evidencia: `api/webhook.ts:55-139` procesa eventos POST, toma `data.id`, consulta Mercado Pago con access token y escribe en `orders`; no lee headers de firma ni valida origen.
Riesgo: un tercero podria forzar consultas a Mercado Pago y provocar escrituras/actualizaciones no autorizadas si conoce o adivina IDs validos, ademas de consumir recursos.
Recomendacion: validar firma oficial del webhook, timestamp, request id y topic; rechazar eventos no verificables con codigo apropiado; registrar intentos fallidos.

### Critica - Checkout no crea orden interna ni reserva stock antes de redirigir

Evidencia: `api/create-preference.ts:72-113` crea preferencia y devuelve URL; `api/create-preference.ts:190` deja TODO para stock, ordenes y webhooks.
Riesgo: no hay trazabilidad confiable de carrito iniciado, no se puede reconciliar abandono/pago, no hay reserva ni control de concurrencia.
Recomendacion: crear `orders` y `order_items` en estado `pending` antes de Mercado Pago, usar `external_reference` propio, validar stock transaccionalmente y actualizar por webhook.

### Critica - Persistencia y seguridad Supabase no estan versionadas

Evidencia: no se encontraron `.sql` ni migraciones; el codigo espera `profiles`, `products`, `settings`, `orders` (`src/services/cms.ts:144-300`, `api/orders.ts:51-66`, `api/webhook.ts:119-120`).
Riesgo: no se puede reproducir ambiente, auditar RLS, permisos por rol, constraints ni indices. Produccion depende de configuracion manual invisible.
Recomendacion: versionar migraciones Supabase, RLS, indices, constraints, triggers de perfil/roles y seed seguro de datos base.

### Alta - Operaciones admin de CMS/productos dependen del cliente y de RLS externa

Evidencia: el frontend hace `upsert`, `insert`, `update` y `delete` directo contra Supabase (`src/services/cms.ts:170`, `src/services/cms.ts:246-247`, `src/services/cms.ts:299`).
Riesgo: si RLS esta mal configurado, usuarios no admin podrian modificar productos/settings.
Recomendacion: confirmar RLS restrictivo por rol, o mover mutaciones admin a API serverless con verificacion server-side consistente.

### Alta - Endpoint de ordenes devuelve `select('*')`

Evidencia: `api/orders.ts:65-66` consulta `.from('orders').select('*')`.
Riesgo: puede exponer `metadata` completa de Mercado Pago, PII, campos internos o futuros secretos si se agregan columnas.
Recomendacion: seleccionar campos explicitamente, paginar, filtrar por necesidad y separar metadata sensible.

### Alta - Logs exponen datos sensibles en cliente y serverless

Evidencia: `src/auth/AuthProvider.tsx:53`, `src/auth/AuthProvider.tsx:111-137`, `src/services/checkoutService.ts:19`, `api/webhook.ts:109`.
Riesgo: sesiones, perfiles, payloads de checkout y datos de pago pueden quedar en consola de navegador o logs de produccion.
Recomendacion: eliminar logs de depuracion del cliente, usar logger con niveles en backend y sanitizar PII/payment metadata.

### Alta - Paginas de resultado confian en query params

Evidencia: `src/hooks/usePaymentResult.ts:10-21` lee `payment_id`, `status` y `external_reference` desde URL; `src/pages/PaymentResultPage.tsx:50-52` los muestra.
Riesgo: el usuario puede manipular la URL y ver una pantalla de pago aprobado sin verificacion real.
Recomendacion: consultar una orden por `external_reference` propio y mostrar estado confirmado por backend.

### Alta - Registro publico no esta contextualizado

Evidencia: `/registro` esta expuesto en `src/App.tsx:28`; `src/auth/AuthProvider.tsx:167-178` permite `signUp`; navbar muestra `Registrarse` a usuarios anonimos (`src/components/Navbar.tsx:194-207`).
Riesgo: si la app solo requiere admin, aumenta superficie de cuentas. Si tambien habra clientes, faltan perfil, email verification, consentimiento y flujo comercial.
Recomendacion: decidir modelo: registro de clientes o panel privado. Si panel privado, ocultar/deshabilitar registro; si clientes, completar onboarding y politicas.

### Alta - Falta modelo de stock, envio y datos de comprador

Evidencia: `Product` no incluye stock (`src/types/cms.ts:22-32`); checkout solo envia `productId` y `quantity` (`src/services/checkoutService.ts:9-18`).
Riesgo: se pueden vender cantidades no disponibles y no hay datos suficientes para cumplir una orden.
Recomendacion: agregar inventario, reserva, direccion/contacto, metodo de entrega, validacion de disponibilidad y estados operativos.

### Media - Fallback local incompatible con carrito

Evidencia: fallback usa IDs tipo slug (`src/lib/defaultContent.ts:4-87`), pero `CartProvider.addItem` rechaza cualquier `productId` que no sea UUID (`src/cart/CartProvider.tsx:50-59`).
Riesgo: en modo sin Supabase, "Comprar" puede no agregar nada al carrito salvo un error en consola.
Recomendacion: usar UUIDs en fallback o separar validacion de checkout server-side del agregado visual al carrito.

### Media - Upload Cloudinary desde cliente con preset publico

Evidencia: `src/services/cloudinary.ts:1-22` sube directo a Cloudinary usando `VITE_CLOUDINARY_CLOUD_NAME` y `VITE_CLOUDINARY_UPLOAD_PRESET`.
Riesgo: si el preset no esta restringido, abuso de upload, costos o contenido no deseado.
Recomendacion: restringir preset unsigned por carpeta, tipo, tamano y moderation, o firmar uploads desde backend para admins.

### Media - Sin CORS/rate limiting/headers de seguridad propios

Evidencia: no hay dependencias/configuracion `cors`, `helmet`, `rate limiter` ni headers en `vercel.json`; las funciones aceptan requests sin rate limiting (`api/*.ts`).
Riesgo: abuso de endpoints, falta de defensa ante scraping, spam de checkout/webhook y headers incompletos.
Recomendacion: agregar rate limiting por IP/usuario donde aplique, headers de seguridad en Vercel y allowlist si se exponen endpoints sensibles.

### Media - No hay lint ni tests configurados

Evidencia: `package.json:6-9` solo define `dev`, `build` y `preview`; busqueda de `describe/test/vitest/jest/playwright/cypress/eslint/prettier` no encontro configuracion util.
Riesgo: regresiones visuales, auth/checkout rotos y drift de calidad sin alarma automatica.
Recomendacion: agregar ESLint/Prettier y tests unitarios para servicios/providers, integracion para checkout/webhook mockeados y e2e para flujos criticos.

### Media - SEO y accesibilidad base incompletos

Evidencia: `index.html:2-10` usa `<html lang="en">`, solo titulo `Rehabex`, sin meta description, OG, canonical ni favicon.
Riesgo: peor indexacion, previews pobres y lectores de pantalla con idioma incorrecto.
Recomendacion: cambiar a `lang="es-AR"`, agregar metadatos, favicon, robots/sitemap si corresponde y estrategia de SEO por producto.

### Media - Textos con encoding roto y falta de acentos

Evidencia: `src/admin/components/OrdersTable.tsx:83-97`, `src/components/Navbar.tsx:133`, `src/components/Footer.tsx:15`; tambien muchos textos sin acentos (`Contrasena`, `Catalogo`, `sesion`).
Riesgo: baja confianza comercial y UX poco profesional.
Recomendacion: normalizar codificacion UTF-8, revisar copy completo y definir convencion de idioma.

### Media - Componentes/paginas grandes mezclan responsabilidades

Evidencia: `src/admin/pages/AdminProductsPage.tsx` mide 10.934 bytes y maneja fetch, form, listado, CRUD y mensajes; `src/components/Navbar.tsx` mide 7.355 bytes y combina auth, cart, responsive y contacto.
Riesgo: redisenio visual con alto riesgo de romper logica.
Recomendacion: extraer hooks (`useProductsAdmin`, `useNavbarState`), componentes presentacionales y adaptadores de datos antes de redisenar.

### Baja - TODOs obsoletos o no resueltos

Evidencia: `src/pages/StorePage.tsx:119`, `src/pages/ProductDetailPage.tsx:110` dicen conectar boton a carrito, pero ya llaman `handleAddToCart`; `api/create-preference.ts:190` marca validacion pendiente.
Riesgo: confunde mantenimiento y priorizacion.
Recomendacion: eliminar TODOs obsoletos y convertir pendientes reales en issues/tareas.

### Baja - Estilo visual poco sistematizado

Evidencia: uso extendido de `rounded-[2rem]`, `rounded-2xl`, shadows y letter spacing arbitrario (`src/index.css:203`, `src/components/FeaturedProductsSection.tsx:31-90`, `src/admin/components/AdminLayout.tsx:33-69`).
Riesgo: redisenio costoso si cada pantalla redefine detalles visuales.
Recomendacion: crear design tokens y componentes UI base antes del redisenio completo.

## Resultados de verificacion

| Comando | Resultado | Observacion |
| --- | --- | --- |
| `git status --short --branch` | OK | `## main...origin/main`; sin cambios iniciales. |
| `npm run build` | OK | `tsc -b && vite build`; 125 modulos transformados; JS 445.99 kB gzip 127.29 kB; CSS 28.22 kB gzip 6.08 kB. |
| `npm run lint --if-present` | Sin salida | No hay script `lint` configurado. |
| `npm test --if-present` | Sin salida | No hay script `test` configurado. |
| `npm audit --omit=dev` | OK | `found 0 vulnerabilities`. |
| `git status --short` despues del build | OK | Sin cambios reportados. |

No se ejecutaron comandos que requieran credenciales, base de datos remota, pagos reales, migraciones, seeds ni escritura en servicios externos.

## Evaluacion de seguridad

Fortalezas:

- Las credenciales server-only (`MERCADOPAGO_ACCESS_TOKEN`, `SUPABASE_SERVICE_ROLE_KEY`) se usan en `api/`, no como `VITE_*` (`api/create-preference.ts:48-50`, `api/webhook.ts:76-78`, `api/orders.ts:20-21`).
- El cliente Supabase usa anon key y `persistSession` (`src/lib/supabase.ts:3-13`).
- Admin UI verifica sesion y role antes de renderizar (`src/auth/ProtectedRoute.tsx:15-31`).
- `/api/orders` valida Bearer token con Supabase Auth y role admin server-side (`api/orders.ts:39-57`).
- Inputs principales de producto validan nombre, precio e imagen antes de guardar (`src/services/cms.ts:264-276`).

Riesgos:

- Webhook sin firma.
- RLS no auditable desde repo.
- Mutaciones directas desde cliente.
- Logs con PII/sesion/payloads.
- `select('*')` en ordenes.
- Sin rate limiting ni headers de seguridad versionados.
- Upload Cloudinary publico.
- Resultado de pago manipulable desde URL.
- Sin control de stock/concurrencia.

## Evaluacion UX/UI

Funciona:

- Navegacion principal a tienda, carrito, auth y admin.
- Estados loading/error/empty en tienda, detalle, carrito y ordenes.
- Layout responsive basico con Tailwind.
- CTAs visibles para compra, detalle y contacto.
- Feedback de agregado al carrito.

Incompleto o problematico:

- No hay busqueda, filtros, ordenamiento, categorias navegables ni paginacion.
- La ficha de producto no tiene atributos comerciales suficientes: stock, cuotas, envio, garantia, dimensiones, instrucciones, disponibilidad real ni cross-sell.
- Checkout no pide datos de envio/contacto ni confirma orden.
- Footer y WhatsApp usan datos placeholder.
- SEO minimo y `lang` incorrecto.
- Copy con mojibake y falta de acentos.
- Panel admin no tiene confirmaciones destructivas, preview clara ni auditoria.
- No hay pruebas visuales responsive automatizadas.

## Rendimiento

- Build de produccion correcto.
- Bundle principal observado: `445.99 kB`, gzip `127.29 kB`.
- Las imagenes de producto/fallback cargan desde URLs remotas sin control de optimizacion local (`src/lib/defaultContent.ts:8-82`).
- Hero usa background image inline (`src/components/HeroSection.tsx:13`), lo que dificulta `alt`, lazy/eager control y optimizacion semantica.
- No hay code splitting explicito por rutas admin/publicas.

## Calidad y mantenibilidad

Fortalezas:

- TypeScript en modo `strict` y `noUnused*` (`tsconfig.app.json:14-16`).
- Separacion inicial razonable entre pages, components, services, auth y cart.
- Build exitoso.
- Tipos de CMS centralizados.

Debilidades:

- Sin lint, formatter ni tests.
- Paginas grandes con logica y presentacion mezcladas.
- Sin schema/migraciones/docs tecnicas.
- Comentarios TODO desactualizados.
- Configuracion Vercel minima.
- Datos fallback hardcodeados y parcialmente incompatibles.
- `.env.example` esta versionado aunque `.gitignore` tambien lo ignora; conviene revisar la intencion del repo.

## Matriz de decision

| Area | Decision | Motivo |
| --- | --- | --- |
| React/Vite/Tailwind base | Conservar | Stack simple, compila y es suficiente para SPA e-commerce inicial. |
| Rutas actuales | Conservar/corregir | Cubren flujos base; falta 404 y separar public/admin. |
| `AuthProvider` | Refactorizar | Logica util, pero hay logs sensibles y acoplamiento a profile. |
| `CartProvider` | Refactorizar | Base valida, pero debe aceptar modo fallback o delegar validacion a checkout; falta stock/precio fresco. |
| `services/cms.ts` | Refactorizar | Es util como adaptador, pero mezcla fallback, validacion y CRUD directo. |
| `api/create-preference.ts` | Corregir | Debe crear orden, external_reference, stock y validaciones transaccionales. |
| `api/webhook.ts` | Corregir prioritario | Falta firma, idempotencia de negocio y sanitizacion de logs. |
| `api/orders.ts` | Corregir | Evitar `select('*')`, paginar y tipar respuesta. |
| Admin productos | Refactorizar | Funcional, pero demasiado grande y sin confirmacion de delete. |
| Admin hero/about | Conservar/refactorizar leve | Sirve para CMS simple; mejorar validacion y preview. |
| UI visual actual | Reemplazar parcialmente | Base usable, pero no esta sistematizada ni lista para redisenio premium. |
| Default content | Corregir/eliminar | Util para demo, pero IDs no UUID rompen carrito y contiene placeholders. |
| Cloudinary upload | Corregir | Asegurar preset restringido o firma server-side. |
| `.env.example` | Conservar/corregir | Necesario como contrato, pero debe incluir Cloudinary y revisar ignore. |
| Tests/lint | Agregar | No existen. |
| Migraciones/RLS | Agregar | Critico para reproducibilidad y seguridad. |

## Plan de trabajo priorizado

Etapa 0 - Congelar estado y documentar contrato:

- Definir ambientes, Node >=20, variables requeridas y responsabilidades de Supabase/Mercado Pago/Cloudinary.
- Versionar schema inicial, RLS, indices y constraints.
- Decidir si `/registro` es para clientes o debe ser privado/deshabilitado.

Etapa 1 - Seguridad y pagos:

- Validar firma de webhook Mercado Pago.
- Crear orden interna antes de preferencia con `external_reference`.
- Agregar `order_items`, estados, idempotencia y reconciliacion.
- Eliminar logs sensibles.
- Limitar `/api/orders` a campos necesarios y paginacion.

Etapa 2 - Comercio real:

- Agregar stock, disponibilidad, reserva y control de concurrencia.
- Agregar datos de comprador, envio/contacto y confirmacion post compra.
- Sincronizar precios desde backend durante checkout.
- Definir flujo de notificaciones.

Etapa 3 - Calidad automatizada:

- Agregar ESLint/Prettier.
- Tests unitarios para `cms`, carrito, auth y helpers de checkout.
- Tests de integracion para APIs con mocks de Supabase/Mercado Pago.
- E2E para tienda, carrito, checkout mock, login y admin.

Etapa 4 - Redisenio visual sin romper logica:

- Extraer hooks de datos/acciones antes de tocar UI: productos, detalle, carrito, admin products, orders.
- Crear componentes presentacionales puros para product card, product detail, cart item, admin form, status badge.
- Definir tokens de marca, layout, tipografia, estados y sistema responsive.
- Hacer redisenio por flujo, validando build y pruebas despues de cada etapa.

Etapa 5 - Produccion:

- Configurar headers, runtime Node, variables, previews y monitoreo.
- Agregar logs estructurados sin PII.
- Verificar RLS con tests.
- Revisar accesibilidad, SEO, sitemap, OG, favicon y performance.

## Preparacion para redisenio visual

Puede redisenarse sin reescribir todo si primero se desacopla:

- Mantener rutas y contratos de servicios.
- Mantener `Product`, `LandingContent` y `CartItem` como contrato inicial.
- Extraer logica de carga/error/form de las paginas grandes.
- Crear una capa UI nueva y migrar pantalla por pantalla.
- No tocar checkout/webhook durante redisenio salvo para corregir contratos explicitamente testeados.

Riesgo actual del redisenio directo: medio/alto. Las paginas mezclan fetch, estado, render y acciones; cambiar markup podria romper interacciones como agregar carrito, auth admin, upload y mensajes.

## Inferencias y limites de la auditoria

Inferencias:

- Se infiere uso de Supabase como base primaria por imports y queries, pero no se verifico instancia remota.
- Se infiere deploy Vercel por `vercel.json` y carpeta `.vercel`, pero no se inspeccionaron settings remotos.
- Se infiere Mercado Pago como procesador por SDK y endpoints, pero no se hicieron llamadas reales.
- Se infiere Cloudinary como proveedor de imagenes por `VITE_CLOUDINARY_*`, pero no se probo upload.

Limites:

- No se leyo `.env`.
- No se conecto a Supabase, Mercado Pago ni Cloudinary.
- No se verificaron RLS/policies reales.
- No se hicieron pruebas en navegador ni screenshots responsive.
- No hay tests existentes para ejecutar.

## Veredicto de produccion

Rehabex **no esta preparado para produccion comercial**. La base frontend compila y varios flujos son navegables, pero el sistema carece de garantias criticas para vender: ordenes confiables, stock, validacion de webhook, seguridad versionada de base de datos, hardening de endpoints, testing y UX de checkout completa.

El codigo que mas conviene conservar como base es la estructura React/Vite, rutas, providers, tipos y servicios como contratos iniciales. Lo prioritario no es redisenar primero, sino estabilizar seguridad y dominio comercial para que el redisenio se apoye sobre logica confiable.
