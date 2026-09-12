# Commerce hardening plan - Rehabex

Fecha: 2026-09-09
Fuente principal: `docs/AUDIT_REHABEX_2026-09.md`
Alcance: diseno tecnico y plan de implementacion. No se modifico codigo fuente, base de datos, configuracion remota ni servicios externos.

## 1. Resumen ejecutivo

La decision de negocio cambia el objetivo de Rehabex: ya no alcanza con catalogo y consulta asistida. El sistema debe soportar e-commerce completo con catalogo, stock real, carrito, checkout, Mercado Pago, retiro/entrega, orden interna y seguimiento administrativo.

La arquitectura actual sirve como base de frontend y prototipo funcional, pero el dominio comercial debe endurecerse antes del redisenio visual. La prioridad es introducir un modelo de datos reproducible, transacciones atomicas de stock, ordenes internas, estados separados, webhooks verificables e idempotencia. El redisenio debe ocurrir despues de extraer contratos y hooks para no romper carrito, auth, productos y ordenes.

Veredicto de esta etapa: avanzar con un hardening por fases. Primero schema/RLS y contratos backend, despues checkout/stock/webhook, luego admin y UX.

## 2. Correcciones o matices a la auditoria original

- La auditoria indicaba que el flujo podia parecer compra asistida por WhatsApp en algunos textos. Con la decision confirmada, WhatsApp queda como canal de soporte, no como cierre comercial principal.
- La auditoria recomendaba decidir si `/registro` era publico o privado. Ahora la decision queda pendiente solo en modalidad: compra con cuenta, checkout invitado o ambos. El sistema debe poder operar al menos con checkout invitado seguro.
- La auditoria marcaba `orders.status` como mezcla riesgosa. El modelo objetivo separa `payment_status`, `fulfillment_status` y `order_status`.
- La auditoria mencionaba stock como faltante. El objetivo ahora requiere reserva atomica y liberacion por vencimiento, rechazo, cancelacion o error.
- La auditoria senalo Cloudinary unsigned como riesgo. Para un MVP comercial, la carga de imagenes debe limitarse al admin y preferentemente pasar por firma server-side.
- El plan original permitia una ambiguedad peligrosa en pagos aprobados despues del vencimiento de la reserva. Este documento ahora exige procesar esa aprobacion en una transaccion: consumir la reserva si sigue activa, readquirir stock si vencio pero hay disponibilidad, o dejar la orden `on_hold` con revision auditada si ya no hay stock.
- El plan original proponia llevar un token publico en la URL de retorno. Se corrige: ningun token secreto o pseudo-secreto debe viajar en `back_urls` ni query params; el frontend debe guardarlo en `sessionStorage` antes de redirigir y enviarlo luego por header.

## 3. Arquitectura actual relevante

Hechos comprobados por analisis estatico:

- `src/types/cms.ts` define `Product` con `id`, `name`, `description`, `price`, `imageUrl`, `category`, `featured`, `sortOrder`, `active`, `createdAt`. No hay stock, SKU, dimensiones, moneda, imagenes multiples ni atributos de envio.
- `src/services/cms.ts` consulta `settings` y `products`; usa `PRODUCT_SELECT = 'id, name, description, category, price, image_url, is_featured, display_order, is_active, created_at'`.
- `src/cart/CartProvider.tsx` persiste `CartItem` en `localStorage` con `productId`, `name`, `price`, `imageUrl`, `quantity`. Calcula total localmente y valida UUID al agregar.
- `src/services/checkoutService.ts` envia a `/api/create-preference` solo `{ items: [{ productId, quantity }] }`.
- `api/create-preference.ts` recupera productos por ID, valida `is_active` y precio, crea preferencia Mercado Pago y devuelve `checkoutUrl`. No crea orden ni reserva stock.
- `api/webhook.ts` procesa POST de Mercado Pago, consulta el pago y hace `upsert` en `orders` con `payment_id`, `status`, `amount`, `currency`, `items`, `metadata` y `external_reference`. No valida firma.
- `src/hooks/usePaymentResult.ts` lee `payment_id`, `status` y `external_reference` desde query params.
- `src/admin/components/OrdersTable.tsx` espera `orders` con `payment_id`, `status`, `amount`, `payer_email`, `created_at`, `items`.
- `src/auth/AuthProvider.tsx` usa Supabase Auth y tabla `profiles` con role `admin` o `user`.

## 4. Arquitectura objetivo

Principios:

- El frontend nunca decide precios finales, stock ni estado de pago.
- Toda mutacion comercial critica pasa por backend serverless con service role y validacion propia.
- Supabase mantiene RLS restrictivo para lectura publica controlada y datos privados.
- Las operaciones atomicas de stock se implementan en funciones SQL/RPC transaccionales, invocadas desde backend.
- Mercado Pago queda desacoplado de la orden interna mediante `orders.id` como `external_reference`.
- La pantalla de resultado consulta el estado interno de la orden y no confia en query params de Mercado Pago.
- Los eventos de pago son idempotentes y auditables.

Capas objetivo:

- Frontend publico: catalogo, detalle, carrito, datos de checkout, retorno de pago y estado de orden.
- Frontend admin: productos, inventario, ordenes, fulfillment, pagos/eventos.
- API serverless:
  - `POST /api/checkout`
  - `GET /api/orders/:id/status`
  - `GET /api/admin/orders`
  - `GET /api/admin/orders/:id`
  - `PATCH /api/admin/orders/:id/fulfillment`
  - `POST /api/mercadopago/webhook`
  - `POST /api/admin/uploads/signature`
- Base de datos: schema versionado, RLS, indices, constraints y RPC para checkout/stock.

Arquitectura de compra objetivo:

- Checkout invitado permitido siempre.
- Si existe sesion Supabase valida, `orders.user_id` se asocia al usuario.
- Nunca se exige registro para completar una compra.
- La orden guarda datos snapshot del comprador y entrega para poder operar aunque el cliente no tenga cuenta.

## 5. Modelo de datos propuesto

Tipos enumerados recomendados:

```sql
profile_role: 'admin', 'customer'
delivery_method: 'pickup', 'delivery'
payment_status: 'unpaid', 'pending', 'approved', 'rejected', 'cancelled', 'refunded', 'charged_back'
fulfillment_status: 'not_started', 'preparing', 'ready_for_pickup', 'shipped', 'delivered', 'cancelled', 'returned'
order_status: 'draft', 'pending_payment', 'confirmed', 'on_hold', 'cancelled', 'completed', 'expired', 'refunded', 'failed'
reservation_status: 'active', 'consumed', 'released', 'expired'
inventory_movement_type: 'initial', 'adjustment', 'sale', 'return', 'reservation_release_correction'
payment_event_status: 'received', 'ignored', 'processed', 'failed', 'duplicate', 'invalid_signature'
review_reason: 'late_approved_payment_no_stock', 'payment_amount_mismatch', 'payment_currency_mismatch', 'payment_reference_mismatch', 'manual_fulfillment_block', 'customer_request', 'provider_dispute', 'other'
review_resolution: 'stock_acquired_confirmed', 'refunded_by_provider', 'cancelled_by_provider', 'fulfilled_manually', 'customer_accepted_alternative', 'marked_as_false_positive', 'other'
```

### `profiles`

Necesidad: soportar admin, clientes registrados y auditoria de ordenes.

Columnas:

- `id uuid primary key references auth.users(id) on delete cascade`
- `role profile_role not null default 'customer'`
- `email text`
- `full_name text`
- `phone text`
- `created_at timestamptz not null default now()`
- `updated_at timestamptz not null default now()`

Constraints e indices:

- `check (email is null or position('@' in email) > 1)` como validacion minima, sin reemplazar validacion de app.
- Index `profiles(role)`.
- Trigger `updated_at`.

### `products`

Necesidad: catalogo, precio real y control de stock.

Columnas:

- `id uuid primary key default gen_random_uuid()`
- `sku text unique`
- `name text not null`
- `slug text unique`
- `description text not null default ''`
- `category text`
- `price numeric(12,2) not null`
- `currency char(3) not null default 'ARS'`
- `primary_image_url text not null`
- `is_active boolean not null default true`
- `is_featured boolean not null default false`
- `display_order integer not null default 0`
- `track_stock boolean not null default true`
- `allow_backorder boolean not null default false`
- `stock_on_hand integer not null default 0`
- `low_stock_threshold integer not null default 0`
- `created_at timestamptz not null default now()`
- `updated_at timestamptz not null default now()`

Constraints e indices:

- `check (price > 0)`
- `check (currency = 'ARS')` para MVP; relajar solo si se confirma multi-moneda.
- `check (stock_on_hand >= 0)`
- `check (low_stock_threshold >= 0)`
- `check (track_stock = true or stock_on_hand >= 0)`
- Index parcial `products(is_active, display_order, created_at desc) where is_active = true`
- Index `products(category) where is_active = true`
- Index `products(is_featured, display_order) where is_active = true`
- Index trigram/full-text futuro para busqueda si se agrega `pg_trgm` o `tsvector`.

Compatibilidad: mapear `image_url` actual a `primary_image_url`, o mantener una vista/alias temporal durante migracion.

### `product_images`

Necesidad: en e-commerce completo el detalle de producto requiere galeria, imagen principal y control admin sin sobrecargar `products`.

Columnas:

- `id uuid primary key default gen_random_uuid()`
- `product_id uuid not null references products(id) on delete cascade`
- `url text not null`
- `alt_text text`
- `display_order integer not null default 0`
- `is_primary boolean not null default false`
- `created_at timestamptz not null default now()`

Constraints e indices:

- `unique (product_id, display_order)`
- `unique (product_id) where is_primary = true`
- Index `product_images(product_id, display_order)`

Decision de MVP: se puede implementar despues de estabilizar stock si se mantiene `products.primary_image_url`. Se justifica porque el redisenio visual probablemente necesitara galeria.

### `orders`

Necesidad: registro interno, trazabilidad de checkout, pago y cumplimiento.

Columnas:

- `id uuid primary key default gen_random_uuid()`
- `order_number text unique not null`
- `idempotency_key uuid not null unique`
- `checkout_request_hash text not null`
- `user_id uuid references auth.users(id) on delete set null`
- `customer_email text not null`
- `customer_name text not null`
- `customer_phone text`
- `delivery_method delivery_method not null`
- `delivery_recipient_name text`
- `delivery_phone text`
- `delivery_address_line1 text`
- `delivery_address_line2 text`
- `delivery_city text`
- `delivery_province text`
- `delivery_postal_code text`
- `delivery_notes text`
- `pickup_location_label text`
- `pickup_window text`
- `subtotal_amount numeric(12,2) not null`
- `shipping_amount numeric(12,2) not null default 0`
- `discount_amount numeric(12,2) not null default 0`
- `total_amount numeric(12,2) not null`
- `currency char(3) not null default 'ARS'`
- `payment_status payment_status not null default 'unpaid'`
- `fulfillment_status fulfillment_status not null default 'not_started'`
- `order_status order_status not null default 'draft'`
- `review_required boolean not null default false`
- `review_reason review_reason`
- `review_resolved_at timestamptz`
- `review_resolved_by uuid references auth.users(id) on delete set null`
- `review_resolution review_resolution`
- `mercadopago_preference_id text unique`
- `mercadopago_payment_id text unique`
- `status_access_token_hash text not null`
- `reservation_expires_at timestamptz`
- `paid_at timestamptz`
- `cancellation_requested_at timestamptz`
- `cancellation_requested_by uuid references auth.users(id) on delete set null`
- `cancellation_reason text`
- `refund_requested_at timestamptz`
- `refund_provider_reference text`
- `cancelled_at timestamptz`
- `completed_at timestamptz`
- `created_at timestamptz not null default now()`
- `updated_at timestamptz not null default now()`

Constraints e indices:

- `check (subtotal_amount >= 0)`
- `check (shipping_amount >= 0)`
- `check (discount_amount >= 0)`
- `check (total_amount = subtotal_amount + shipping_amount - discount_amount)`
- `check (currency = 'ARS')`
- `check (checkout_request_hash <> '')`
- `check (order_number <> '')`
- `check (status_access_token_hash <> '')`
- `check (review_required = false or review_reason is not null)`
- `check (review_resolved_at is null or review_resolution is not null)`
- `check (review_resolved_at is null or review_resolved_by is not null)`
- `check (delivery_method = 'pickup' or delivery_address_line1 is not null)`
- `check (delivery_method = 'delivery' or delivery_address_line1 is null)` opcional si se quiere evitar datos ambiguos.
- Index `orders(user_id, created_at desc)`
- Index `orders(order_status, created_at desc)`
- Index `orders(payment_status, created_at desc)`
- Index `orders(fulfillment_status, created_at desc)`
- Index `orders(review_required, created_at desc) where review_required = true`
- Index `orders(reservation_expires_at) where order_status = 'pending_payment'`
- Index `orders(customer_email, created_at desc)`
- Unique global `orders(idempotency_key)`.

`order_number` debe generarse de forma segura ante concurrencia mediante una secuencia PostgreSQL o una funcion SQL transaccional, por ejemplo `next_order_number()` usando `nextval()` y un prefijo por fecha. No debe calcularse desde `count(*)` ni desde el ultimo numero visible, porque dos checkouts simultaneos podrian generar duplicados.

Idempotencia de checkout:

- `idempotency_key` es globalmente unico para `POST /api/checkout`.
- `checkout_request_hash` se calcula en backend con una serializacion canonica del DTO relevante: items normalizados, customer, delivery, moneda y totales calculables del request, excluyendo campos volatiles.
- Si llega la misma `idempotency_key` con el mismo `checkout_request_hash`, el backend devuelve la orden/preferencia existente si sigue recuperable.
- Si llega la misma `idempotency_key` con otro hash, responder `409 IDEMPOTENCY_CONFLICT`.

Nota sobre `addresses`: no se propone tabla `addresses` para el MVP. La orden debe guardar snapshot de entrega para preservar lo comprado aunque el cliente cambie datos despues. Una tabla `addresses` aporta valor si se confirma compra con cuenta y direcciones reutilizables; hasta entonces agrega complejidad sin resolver el flujo principal.

### `order_items`

Necesidad: snapshots inmutables de productos/precios al momento de compra.

Columnas:

- `id uuid primary key default gen_random_uuid()`
- `order_id uuid not null references orders(id) on delete cascade`
- `product_id uuid references products(id) on delete set null`
- `product_sku text`
- `product_name text not null`
- `product_image_url text`
- `unit_price numeric(12,2) not null`
- `currency char(3) not null default 'ARS'`
- `quantity integer not null`
- `line_total numeric(12,2) not null`
- `created_at timestamptz not null default now()`

Constraints e indices:

- `check (unit_price > 0)`
- `check (quantity > 0)`
- `check (line_total = unit_price * quantity)`
- `unique (order_id, product_id)` mientras no existan variantes.
- Index `order_items(order_id)`
- Index `order_items(product_id)`

### `stock_reservations`

Necesidad: evitar overselling y liberar stock cuando una preferencia no se paga.

Columnas:

- `id uuid primary key default gen_random_uuid()`
- `order_id uuid not null references orders(id) on delete cascade`
- `product_id uuid not null references products(id) on delete restrict`
- `quantity integer not null`
- `status reservation_status not null default 'active'`
- `expires_at timestamptz not null`
- `consumed_at timestamptz`
- `released_at timestamptz`
- `created_at timestamptz not null default now()`

Constraints e indices:

- `check (quantity > 0)`
- `unique (order_id, product_id)`
- Index `stock_reservations(product_id, status, expires_at)`
- Index `stock_reservations(expires_at) where status = 'active'`
- Index `stock_reservations(order_id)`

Disponibilidad calculada:

```sql
available_stock = products.stock_on_hand
  - sum(stock_reservations.quantity where status = 'active' and expires_at > now())
```

### `inventory_movements`

Necesidad: auditoria de inventario y ajustes administrativos.

Columnas:

- `id uuid primary key default gen_random_uuid()`
- `product_id uuid not null references products(id) on delete restrict`
- `order_id uuid references orders(id) on delete set null`
- `reservation_id uuid references stock_reservations(id) on delete set null`
- `movement_type inventory_movement_type not null`
- `quantity_delta integer not null`
- `reason text`
- `created_by uuid references auth.users(id) on delete set null`
- `created_at timestamptz not null default now()`

Constraints e indices:

- `check (quantity_delta <> 0)`
- Para `sale`, `quantity_delta < 0`; para `return` o `initial`, puede ser positivo.
- Index `inventory_movements(product_id, created_at desc)`
- Index `inventory_movements(order_id)`
- Index `inventory_movements(created_by, created_at desc)`

### `payment_events`

Necesidad: idempotencia, auditoria y diagnostico de webhooks Mercado Pago.

Columnas:

- `id uuid primary key default gen_random_uuid()`
- `provider text not null default 'mercadopago'`
- `request_id text`
- `event_type text`
- `provider_event_id text`
- `provider_payment_id text`
- `order_id uuid references orders(id) on delete set null`
- `external_reference text`
- `signature_valid boolean not null default false`
- `signature_ts timestamptz`
- `payload_hash text not null`
- `status payment_event_status not null default 'received'`
- `error_code text`
- `error_message text`
- `raw_payload jsonb`
- `processed_at timestamptz`
- `created_at timestamptz not null default now()`

Constraints e indices:

- `unique (provider, request_id) where request_id is not null`
- `unique (provider, provider_event_id) where provider_event_id is not null`
- Index `payment_events(provider_payment_id, created_at desc)`
- Index `payment_events(order_id, created_at desc)`
- Index `payment_events(payload_hash)`
- Retencion: conservar `raw_payload` solo si no contiene datos sensibles innecesarios; de lo contrario guardar payload minimizado.

## 6. Diagrama de relaciones

```text
auth.users
  1 ── 0..1 profiles
  1 ── 0..n orders

products
  1 ── 0..n product_images
  1 ── 0..n order_items
  1 ── 0..n stock_reservations
  1 ── 0..n inventory_movements

orders
  1 ── 1..n order_items
  1 ── 0..n stock_reservations
  1 ── 0..n inventory_movements
  1 ── 0..n payment_events

payment_events
  n ── 0..1 orders
```

## 7. Maquina de estados

### Estados separados

`payment_status` describe solo el pago:

- `unpaid`: orden creada, sin pago iniciado o sin confirmacion.
- `pending`: Mercado Pago recibio pago pendiente/en revision.
- `approved`: pago aprobado.
- `rejected`: pago rechazado.
- `cancelled`: pago cancelado.
- `refunded`: pago devuelto.
- `charged_back`: contracargo.

`fulfillment_status` describe preparacion/entrega:

- `not_started`: sin preparacion.
- `preparing`: preparando.
- `ready_for_pickup`: listo para retiro.
- `shipped`: enviado.
- `delivered`: entregado.
- `cancelled`: cumplimiento cancelado.
- `returned`: producto devuelto.

`order_status` describe el estado comercial global:

- `draft`: creada localmente antes de preferencia.
- `pending_payment`: preferencia creada, esperando pago.
- `confirmed`: pago aprobado y stock consumido.
- `on_hold`: pago o situacion operativa requiere revision antes de fulfillment, confirmacion final o devolucion.
- `cancelled`: cancelada sin pago aprobado, o cancelada despues de confirmacion monetaria del proveedor.
- `completed`: entregada o retirada.
- `expired`: reserva vencida sin pago.
- `refunded`: devolucion monetaria total.
- `failed`: error tecnico no recuperado.

### Transiciones permitidas

| Campo | Desde | Hacia permitido | Actor | Regla |
| --- | --- | --- | --- | --- |
| order_status | draft | pending_payment | backend checkout | Preferencia creada y reservas activas. |
| order_status | draft | failed | backend checkout | Error luego de crear orden, sin preferencia util. |
| order_status | pending_payment | confirmed | webhook | Pago aprobado, importe/moneda/referencia validos. |
| order_status | expired | confirmed | webhook | Pago aprobado tardio, importe/moneda/referencia validos y stock readquirido atomicamente. |
| order_status | pending_payment/expired | on_hold | webhook | Pago aprobado tardio sin stock, mismatch de importe/moneda o referencia inconsistente. |
| order_status | on_hold | confirmed | admin + proveedor/RPC | Revision resuelta con stock disponible y sin devolucion necesaria. |
| order_status | on_hold | refunded | webhook/API proveedor | Devolucion confirmada por Mercado Pago. |
| order_status | on_hold | cancelled | webhook/API proveedor | Cancelacion monetaria confirmada o caso sin pago aprobado. |
| order_status | pending_payment | cancelled | webhook/admin | Pago rechazado/cancelado o cancelacion manual antes de pago. |
| order_status | pending_payment | expired | job/admin | Reserva vencida y sin pago aprobado. |
| order_status | confirmed | completed | admin | Fulfillment entregado o retirado. |
| order_status | confirmed | refunded | webhook | Devolucion total confirmada por proveedor. |
| order_status | completed | refunded | webhook | Devolucion posterior confirmada por proveedor. |
| order_status | failed | pending_payment | backend retry | Solo si se crea nueva preferencia y reservas vigentes. |
| payment_status | unpaid | pending | webhook | Pago pendiente/revision. |
| payment_status | unpaid | approved | webhook | Pago aprobado directo. |
| payment_status | unpaid | rejected | webhook | Pago rechazado. |
| payment_status | pending | approved | webhook | Pago pendiente aprobado. |
| payment_status | pending | rejected | webhook | Pago pendiente rechazado. |
| payment_status | pending | cancelled | webhook | Pago cancelado confirmado por proveedor. |
| payment_status | approved | refunded | webhook | Devolucion total confirmada por proveedor. |
| payment_status | approved | charged_back | webhook | Contracargo confirmado. |
| fulfillment_status | not_started | preparing | admin | Orden confirmada. |
| fulfillment_status | preparing | ready_for_pickup | admin | Modalidad retiro. |
| fulfillment_status | preparing | shipped | admin | Modalidad entrega. |
| fulfillment_status | ready_for_pickup | delivered | admin | Cliente retiro. |
| fulfillment_status | shipped | delivered | admin | Entrega completada. |
| fulfillment_status | not_started/preparing | cancelled | admin/webhook | Orden cancelada sin pago aprobado, o reembolsada/cancelada despues de confirmacion del proveedor. |
| fulfillment_status | delivered | returned | admin | Devolucion fisica. |

Reglas de consistencia:

- `order_status = confirmed` requiere `payment_status = approved`.
- `order_status = completed` requiere `payment_status = approved` y `fulfillment_status = delivered`.
- `order_status in ('cancelled','expired','failed')` no puede tener reservas activas.
- `order_status = on_hold` no puede disparar fulfillment ni confirmacion al cliente hasta resolucion administrativa auditada y/o confirmacion del proveedor.
- Si `payment_status = approved`, `order_status = on_hold` y `review_required = true`, no confirmar ni devolver dinero automaticamente sin ejecutar y verificar la operacion correspondiente: readquisicion de stock, cancelacion o devolucion ante Mercado Pago.
- `payment_status in ('rejected','cancelled')` libera reservas si la orden no estaba confirmada.
- `payment_status in ('refunded','charged_back')` no reingresa stock automaticamente salvo decision admin o evento de retorno fisico.
- No se permite `order_status: confirmed -> cancelled` mientras `payment_status = approved`. Una solicitud administrativa de cancelacion se registra en `cancellation_requested_at/cancellation_requested_by/cancellation_reason`; el cambio monetario real queda pendiente hasta que Mercado Pago confirme cancelacion, devolucion o contracargo por webhook/API.
- Una devolucion nunca se considera efectiva solo por accion administrativa local. Debe existir confirmacion del proveedor antes de mover `payment_status` a `refunded` y `order_status` a `refunded`.

## 8. Flujo completo de checkout

1. Cliente revisa carrito en frontend. El carrito puede mostrar nombre/precio snapshot local, pero lo marca como no autoritativo.
2. Frontend envia a `POST /api/checkout`:
   - `items`: IDs y cantidades.
   - `customer`: email, nombre, telefono.
   - `delivery`: `pickup` o `delivery` y datos necesarios.
   - `idempotencyKey`: UUID generado por cliente para evitar doble click.
3. Backend valida DTO: shape, UUIDs, cantidades enteras, email, modalidad de entrega e idempotency key.
4. Backend recupera productos y precios reales con service role.
5. Backend valida:
   - producto activo;
   - precio positivo;
   - moneda ARS;
   - cantidad permitida;
   - disponibilidad si `track_stock = true`;
   - modalidad de entrega permitida.
6. Backend inicia operacion atomica en DB mediante RPC, por ejemplo `create_checkout_order`:
   - calcula `checkout_request_hash`;
   - verifica `idempotency_key`;
   - si la clave existe con hash diferente, responde `409 IDEMPOTENCY_CONFLICT`;
   - si la clave existe con el mismo hash, devuelve la orden/preferencia existente cuando sea recuperable;
   - bloquea filas de productos requeridos;
   - calcula reservas activas no vencidas;
   - valida disponibilidad;
   - crea `orders` en `draft`;
   - crea `order_items` snapshots;
   - crea `stock_reservations` activas;
   - deja `reservation_expires_at`;
   - retorna `order_id`, `order_number`, total y token de consulta para guardar fuera de la URL.
7. Backend crea preferencia Mercado Pago:
   - `items` desde `order_items`;
   - `external_reference = orders.id`;
   - `metadata.order_id = orders.id` y datos minimos;
   - `back_urls` con una referencia publica no secreta, por ejemplo `orderRef = order_number` o `orderId`; no incluir `status_access_token`, `public_lookup_token`, `lookupToken` ni ningun secreto en query params;
   - `notification_url` al webhook;
   - `auto_return` si aplica;
   - alinear expiracion de preferencia con `reservation_expires_at` cuando Mercado Pago lo permita para reducir aprobaciones tardias.
8. Si Mercado Pago responde OK:
   - backend guarda `mercadopago_preference_id`;
   - cambia `order_status` de `draft` a `pending_payment`;
   - `payment_status` queda `unpaid`;
   - responde `checkoutUrl`, `orderId`, `orderNumber`, `statusAccessToken`, `reservationExpiresAt`.
9. Cliente guarda `orderId`, `orderNumber` y `statusAccessToken` en `sessionStorage` antes de redirigir a Mercado Pago.
10. Cliente redirige a Mercado Pago.
11. Mercado Pago redirige a success/failure/pending con una referencia publica no secreta. La pantalla recupera el token desde `sessionStorage` y consulta estado interno enviandolo por header, no por query param.
12. Webhook valida firma y procesa evento.
13. Backend consulta el pago por API oficial.
14. Backend valida:
   - `external_reference` coincide con `orders.id`;
   - `transaction_amount` coincide con `orders.total_amount`;
   - `currency_id = orders.currency`;
   - `payment_id` no contradice otro pago asignado;
   - orden permite la transicion.
15. Backend procesa idempotentemente:
   - evento repetido no duplica movimientos;
   - aprobacion consume reserva y descuenta stock;
   - aprobacion posterior al vencimiento intenta readquirir stock atomica y explicitamente;
   - si una aprobacion tardia no puede readquirir stock, no confirma automaticamente y deja la orden `on_hold` con `review_required = true`;
   - rechazo/cancelacion libera reserva;
   - pending mantiene reserva si no vencio.
16. Pantalla de resultado consulta estado interno y muestra proximo paso.
17. Job o endpoint admin libera reservas vencidas: orden `expired`, reservas `expired`, sin afectar stock fisico. Si luego llega pago aprobado, se aplica el flujo de aprobacion tardia descrito en stock/reservas.

## 9. Flujo del webhook

Endpoint objetivo: `POST /api/mercadopago/webhook`.

Secuencia:

1. Aceptar solo POST. Otros metodos devuelven 405.
2. Leer cuerpo crudo o cuerpo parseado de forma compatible con la validacion de firma.
3. Extraer:
   - header `x-signature`;
   - header `x-request-id`;
   - `data.id` del payload.
4. Validar presencia y formato de `data.id`.
5. Validar firma con `MERCADOPAGO_WEBHOOK_SECRET` server-only usando el validador oficial del SDK de Mercado Pago cuando este disponible. Durante la implementacion se debe verificar la documentacion vigente de Mercado Pago y seguir exactamente su formato para `x-signature`, `x-request-id`, `data.id` y timestamp. No se debe inventar una ventana arbitraria ni reimplementar el algoritmo si el SDK provee un validador mantenido.
6. Registrar timestamp/metadata de firma para auditoria y replay analysis segun lo exponga el validador oficial. Si la documentacion vigente define ventana de tolerancia, aplicar esa ventana; si no la define, no imponer una politica no documentada sin aprobacion tecnica.
7. Registrar `payment_events` con `request_id`, `payload_hash`, `signature_valid`, `status`.
8. Si firma invalida:
   - guardar evento minimizado con `invalid_signature`;
   - responder 401 o 403;
   - no consultar Mercado Pago.
9. Si `request_id` ya existe:
   - marcar/retornar como duplicado;
   - responder 200 para evitar reintentos innecesarios.
10. Consultar pago en Mercado Pago por `data.id`.
11. Resolver `order_id` desde `payment.external_reference`.
12. Validar orden existente y valores economicos.
13. Ejecutar transicion en transaccion/RPC:
   - lock de `orders`;
   - lock de reservas/productos si afecta stock;
   - aplicar estado permitido;
   - crear movimiento de inventario una sola vez;
   - marcar evento como `processed`.
14. Responder 200 solo cuando el evento fue recibido correctamente. Errores transitorios pueden responder 500 para permitir retry si la plataforma lo soporta.

Nota: CORS no es la proteccion principal de un webhook. Un webhook es server-to-server y puede ser invocado por clientes no navegador. La proteccion real es firma, secreto, timestamp, idempotencia, validacion contra API oficial y transiciones atomicas.

## 10. Estrategia de stock y reservas

Modelo:

- `products.stock_on_hand` representa unidades fisicas disponibles en deposito.
- `stock_reservations` representa unidades apartadas temporalmente para ordenes pendientes.
- Stock disponible = stock fisico menos reservas activas no vencidas.
- No se descuenta `stock_on_hand` al crear preferencia; se descuenta al aprobar pago.
- La reserva evita que dos clientes compren la ultima unidad mientras pagan.
- La expiracion de la preferencia de Mercado Pago debe alinearse con `stock_reservations.expires_at` cuando el proveedor lo permita. Esto no reemplaza la validacion server-side: solo reduce casos tardios.
- La aprobacion de pago y el cambio de stock siempre ocurren en una unica transaccion/RPC con locks sobre orden, reservas y productos afectados.

Reserva inicial recomendada:

- Valor recomendado: 15 minutos.
- Decision pendiente: confirmar con propietario segun comportamiento esperado de Mercado Pago y operacion interna.

Pago aprobado despues del vencimiento de reserva:

1. Webhook aprobado valida firma, referencia, importe y moneda.
2. Backend bloquea `orders`, `order_items`, `products` y reservas relacionadas.
3. Si la reserva sigue `active`, se consume y descuenta `stock_on_hand`.
4. Si la reserva esta `expired/released`, el backend recalcula disponibilidad.
5. Si hay stock suficiente, readquiere stock atomica y explicitamente: crea o reactiva una reserva transitoria, la consume en la misma transaccion, descuenta inventario y confirma la orden.
6. Si no hay stock suficiente, no confirma automaticamente. Registra excepcion de conciliacion en `payment_events` con estado `failed` o codigo `LATE_APPROVAL_STOCK_UNAVAILABLE` y deja la orden en:
   - `payment_status = approved`;
   - `order_status = on_hold`;
   - `fulfillment_status = not_started`;
   - `review_required = true`;
   - `review_reason = 'late_approved_payment_no_stock'`.
7. La resolucion de la revision debe ser una operacion administrativa auditada: guardar `review_resolved_at`, `review_resolved_by` y `review_resolution`. No se debe confirmar la orden ni devolver dinero automaticamente sin ejecutar y verificar la operacion correspondiente: readquirir stock, iniciar/corroborar devolucion en Mercado Pago, cancelar con confirmacion del proveedor o acordar alternativa con el cliente.

Escenarios:

| Escenario | Comportamiento objetivo |
| --- | --- |
| Webhook repetido | `payment_events` detecta duplicado por `request_id` o por estado ya aplicado. No duplica movimientos ni cambia stock dos veces. |
| Webhook fuera de orden | Si llega `approved` antes de que el usuario vuelva, la orden pasa a `confirmed`; la pantalla luego lee estado interno. Si llega `pending` despues de `approved`, se registra como evento fuera de orden y no degrada el pago. |
| Pago aprobado despues de pantalla pending | Pantalla pending consulta estado periodicamente o permite refrescar; webhook cambia a `confirmed` cuando aprueba. |
| Pago aprobado despues de reserva vencida | Si hay stock disponible, se readquiere atomica y se confirma. Si no hay stock, queda `payment_status = approved`, `order_status = on_hold`, `fulfillment_status = not_started`, `review_required = true` y `review_reason = 'late_approved_payment_no_stock'`. |
| Pago rechazado | `payment_status = rejected`, `order_status = cancelled`, reservas `released`; frontend permite reintentar creando nueva orden/preferencia. |
| Preferencia creada pero nunca pagada | Al vencer `reservation_expires_at`, job libera reservas y marca orden `expired`. |
| Stock insuficiente | `POST /api/checkout` responde 409 con items afectados y stock disponible. No crea preferencia. |
| Dos clientes comprando ultima unidad | RPC bloquea productos; la primera reserva gana, la segunda ve disponibilidad 0 y recibe 409. |
| Cancelacion | Si no pago: liberar reservas y cancelar orden. Si pago aprobado: requiere devolucion/cancelacion en Mercado Pago y transicion auditada. |
| Devolucion | `payment_status = refunded`, `order_status = refunded`. Stock se reingresa solo cuando admin confirma retorno fisico o politica lo indique. |
| Importe o moneda incorrectos | Webhook registra evento `failed`, no confirma orden, alerta admin. No consume reserva. |
| Error de Mercado Pago despues de crear orden | Orden queda `failed` o `draft` con reservas liberadas segun punto de falla; se responde error recuperable al frontend. |

## 11. RLS propuesta por tabla y operacion

Supuestos:

- Lectura publica de productos activos.
- Mutaciones admin pasan preferentemente por endpoints serverless con service role.
- Clientes pueden consultar sus propias ordenes si estan autenticados.
- Checkout invitado consulta estado mediante endpoint backend y token, no RLS publica directa.

| Tabla | Select anon | Select auth customer | Select admin | Insert/update/delete customer | Admin mutation | Service role |
| --- | --- | --- | --- | --- | --- | --- |
| profiles | No | Propio perfil | Todos | Update limitado propio, sin role | Via API o policy admin | Si |
| products | Solo activos y campos publicos | Igual anon | Todos | No | Via API/policy admin | Si |
| product_images | Imagenes de productos activos | Igual anon | Todas | No | Via API/policy admin | Si |
| orders | No | Propias por `user_id` | Todas | No directo | Via API | Si |
| order_items | No | Items de propias ordenes | Todos | No | Via API | Si |
| stock_reservations | No | No directo | Todos | No | No directo salvo API | Si |
| inventory_movements | No | No | Todos | No | Via API | Si |
| payment_events | No | No | Minimizados para admin | No | No directo salvo API | Si |

Politicas clave:

- `is_admin()` como funcion SQL que consulta `profiles.role = 'admin'`.
- Nunca permitir update de `profiles.role` por el propio usuario.
- Productos activos visibles con columnas publicas; productos inactivos solo admin.
- Ordenes invitadas no se leen directo desde anon; usar endpoint backend con token de estado enviado en header. El hash queda en `orders.status_access_token_hash`; el token plano solo existe en la respuesta inicial y en `sessionStorage` del navegador antes de redirigir.
- Mutaciones de stock, ordenes, eventos y pagos solo service role/RPC.

## 12. Contratos de endpoints

### `POST /api/checkout`

Request:

```json
{
  "idempotencyKey": "uuid",
  "items": [
    { "productId": "uuid", "quantity": 1 }
  ],
  "customer": {
    "email": "cliente@example.com",
    "name": "Nombre Apellido",
    "phone": "+54..."
  },
  "delivery": {
    "method": "delivery",
    "address": {
      "line1": "Calle 123",
      "line2": "Piso 1",
      "city": "CABA",
      "province": "Buenos Aires",
      "postalCode": "1000",
      "notes": "Timbre..."
    }
  }
}
```

Response 200:

```json
{
  "orderId": "uuid",
  "orderNumber": "RHB-202609-000001",
  "checkoutUrl": "https://...",
  "statusAccessToken": "opaque-token-store-in-sessionStorage-only",
  "reservationExpiresAt": "2026-09-09T22:30:00.000Z"
}
```

Errores:

- 400 `VALIDATION_ERROR`
- 409 `STOCK_UNAVAILABLE`
- 409 `IDEMPOTENCY_CONFLICT`
- 502 `PAYMENT_PROVIDER_ERROR`
- 500 `CHECKOUT_FAILED`

Si se recibe una `idempotencyKey` ya usada con un payload distinto, responder siempre `409 IDEMPOTENCY_CONFLICT`. No debe crearse una segunda orden ni devolverse la orden anterior como si fuera compatible.

### `GET /api/orders/:orderId/status`

Uso: pantalla success/failure/pending y checkout invitado.

Headers:

- `X-Order-Status-Token: <statusAccessToken>` para checkout invitado.
- `Authorization: Bearer <access_token>` opcional si el usuario esta autenticado.

Query params permitidos:

- Ningun token secreto. La URL de retorno puede incluir `orderRef` u otra referencia publica no secreta solo para ubicar la orden visualmente.

Response:

```json
{
  "orderId": "uuid",
  "orderNumber": "RHB-202609-000001",
  "paymentStatus": "approved",
  "fulfillmentStatus": "not_started",
  "orderStatus": "confirmed",
  "totalAmount": 12345,
  "currency": "ARS",
  "reservationExpiresAt": null,
  "nextAction": "wait_for_fulfillment"
}
```

Autorizacion:

- Si usuario autenticado y `orders.user_id = auth.user.id`, permitir sin token.
- Si invitado, exigir `X-Order-Status-Token` y comparar contra `status_access_token_hash`.
- Admin puede consultar desde endpoint admin.

### `POST /api/mercadopago/webhook`

Headers requeridos:

- `x-signature`
- `x-request-id`

Body minimo esperado:

```json
{
  "type": "payment",
  "data": { "id": "provider-payment-id" }
}
```

Response:

- 200 recibido/procesado/duplicado.
- 401/403 firma invalida.
- 400 payload invalido.
- 500 error transitorio procesable por retry.

### `GET /api/admin/orders`

Query:

- `status`
- `paymentStatus`
- `fulfillmentStatus`
- `limit`
- `cursor`
- `from`
- `to`

Response: lista paginada con campos explicitos, no `select('*')`.

### `GET /api/admin/orders/:id`

Response: detalle con order, items, eventos minimizados, reservas y movimientos relacionados.

### `PATCH /api/admin/orders/:id/fulfillment`

Request:

```json
{
  "nextFulfillmentStatus": "preparing",
  "note": "Preparacion iniciada"
}
```

Regla: validar admin server-side y transicion permitida.

### `POST /api/admin/orders/:id/cancellation-request`

Uso: registrar intencion administrativa de cancelar o devolver una orden. No cambia `payment_status` a `refunded` ni `order_status` a `cancelled/refunded` si el pago sigue `approved`.

Request:

```json
{
  "reason": "Cliente solicito cancelacion",
  "requestedAction": "cancel_or_refund"
}
```

Regla:

- Si la orden no tiene pago aprobado, puede liberar reservas y cancelar mediante transicion valida.
- Si `payment_status = approved`, solo registra solicitud y, si se implementa integracion, inicia el pedido ante Mercado Pago. El estado monetario final se actualiza despues por webhook/API confirmada del proveedor.

### `POST /api/admin/uploads/signature`

Uso: firma server-side para Cloudinary. Solo admin.

Response: parametros firmados con carpeta, timestamp, public_id y restricciones.

## 13. Estrategia de errores e idempotencia

Errores:

- Usar DTOs explicitos y codigos estables: `VALIDATION_ERROR`, `AUTH_REQUIRED`, `FORBIDDEN`, `STOCK_UNAVAILABLE`, `IDEMPOTENCY_CONFLICT`, `ORDER_NOT_FOUND`, `ORDER_STATE_CONFLICT`, `PAYMENT_SIGNATURE_INVALID`, `PAYMENT_AMOUNT_MISMATCH`, `PAYMENT_CURRENCY_MISMATCH`, `LATE_APPROVAL_STOCK_UNAVAILABLE`, `PAYMENT_PROVIDER_ERROR`, `CHECKOUT_FAILED`.
- Mensajes publicos sin PII ni detalles internos.
- Logs server-side con correlation id, order id y provider ids, sin payload completo salvo evento minimizado.

Idempotencia:

- `POST /api/checkout` exige `idempotencyKey`; guardar la clave en `orders.idempotency_key` con unique global.
- Guardar `checkout_request_hash` junto a la orden. Repetir la misma clave con el mismo hash devuelve la orden/preferencia existente cuando sea recuperable; repetirla con otro hash devuelve `409 IDEMPOTENCY_CONFLICT`.
- Webhook usa `x-request-id`, `provider_event_id` si existe, `provider_payment_id` y transiciones idempotentes.
- Movimiento de inventario de venta debe ser unico por `order_id/product_id/movement_type = sale`; esto evita doble descuento.
- Si una orden ya esta `confirmed`, otro evento `approved` del mismo pago no cambia stock.
- Si llega un estado menos avanzado luego de uno final, se registra pero no degrada.

Replay:

- Usar el validador oficial del SDK/documentacion vigente para interpretar `x-signature`, `x-request-id`, `data.id` y cualquier timestamp asociado.
- Registrar timestamp/metadata de firma para auditoria. Solo rechazar por ventana temporal si Mercado Pago lo documenta o el SDK lo implementa oficialmente.
- Guardar `payload_hash` y `request_id`.
- No depender de CORS.

## 14. Impacto sobre el codigo actual

Contratos que pueden conservarse:

- `Product` como concepto publico, extendido con `slug`, `sku`, `currency`, `stock`, `trackStock` y `primaryImageUrl` manteniendo `imageUrl` temporalmente.
- `CartItem` puede conservar `productId`, `name`, `price`, `imageUrl`, `quantity` como snapshot local no autoritativo.
- `formatCurrency`.
- Rutas `/tienda`, `/productos/:id`, `/carrito`, `/success`, `/failure`, `/pending`, `/admin/ordenes`.
- `AuthProvider` y `ProtectedRoute`, despues de eliminar logs y ampliar roles.

Cambios que romperian dependencias:

- Renombrar `Product.imageUrl` rompe `StorePage`, `ProductDetailPage`, `FeaturedProductsSection`, `AdminProductsPage`, `ImageField` y `CartProvider`.
- Cambiar `Product.price` a string rompe `formatCurrency` y calculos de carrito.
- Reemplazar `orders.status` por tres estados rompe `OrdersTable` y `api/orders.ts`.
- Cambiar respuesta de `createCheckoutPreference` de string a objeto exige actualizar `CartPage`.
- Remover checkout por query params exige actualizar `PaymentResultPage` y `usePaymentResult`.

Estrategia de compatibilidad:

- Crear tipos nuevos `CommerceProduct`, `CheckoutRequest`, `CheckoutResponse`, `OrderSummary`, `OrderDetail`.
- Mantener mapper `mapProductRow` devolviendo tambien `imageUrl` mientras UI migra.
- Mantener `createCheckoutPreference` como wrapper de frontend que llama al nuevo `createCheckoutSession` y devuelve `checkoutUrl` hasta migrar `CartPage`; no mantener el endpoint antiguo inseguro como fallback productivo.
- Mantener `orders.status` en API admin temporalmente como alias derivado de `order_status` si la UI vieja lo necesita.
- Migrar `OrdersTable` a tres badges de estado en una fase separada.

## 15. Archivos que serian modificados

No se modifican en esta etapa. Para implementacion futura:

- `package.json`: scripts de lint/test, engines Node >=20, dependencias de validacion/test si se aprueban.
- `src/types/cms.ts`: extender `Product` o separar tipos commerce.
- `src/cart/CartProvider.tsx`: quitar validacion UUID del agregado local o convertirla en validacion de checkout; soportar stock UI.
- `src/services/checkoutService.ts`: nuevo contrato `POST /api/checkout`.
- `src/pages/CartPage.tsx`: formulario de comprador/entrega, respuesta con order id/token, manejo 409.
- `src/hooks/usePaymentResult.ts`: reemplazar query params por consulta de estado interno.
- `src/pages/PaymentResultPage.tsx`, `SuccessPage.tsx`, `FailurePage.tsx`, `PendingPage.tsx`: render por estado interno.
- `api/create-preference.ts`: reemplazar por `api/checkout.ts`; cualquier wrapper temporal debe limitarse a desarrollo/staging y no a ventas reales.
- `api/webhook.ts`: mover a `api/mercadopago/webhook.ts` o endurecer archivo actual.
- `api/orders.ts`: separar admin listing y public status.
- Nuevo endpoint admin para solicitud de cancelacion/devolucion sin cambiar pago hasta confirmacion de proveedor.
- `src/admin/components/OrdersTable.tsx`: nuevo modelo con tres estados y paginacion.
- `src/admin/pages/AdminProductsPage.tsx`: stock, SKU, active, featured, imagenes.
- `src/services/cms.ts`: mappers nuevos y endpoints admin para mutaciones.
- `src/services/cloudinary.ts` y `src/admin/components/ImageField.tsx`: upload firmado.
- Nuevos archivos esperados: migraciones SQL, helpers de auth admin, DTO validators, tests unitarios/integracion/e2e.

## 16. Plan por fases con dependencias

Fase 0 - Contrato y decisiones minimas:

- Confirmar checkout invitado/cuenta, entrega/retiro, reserva, devoluciones y datos fiscales.
- Definir nombres de estados y codigos de error.
- Dependencia: aprobacion del propietario.

Fase 1 - Schema y RLS versionados:

- Recuperar baseline del esquema remoto antes de crear migraciones: tablas, columnas, constraints, indices, triggers, funciones y RLS existentes.
- Comparar baseline con el modelo objetivo y documentar diferencias.
- Generar migraciones incrementales. No sobrescribir, dropear ni recrear objetos a ciegas.
- Crear migraciones para tablas, enums, indices, constraints, triggers.
- Crear funciones `is_admin`, `create_checkout_order`, `consume_order_reservation`, `release_order_reservation`.
- Crear politicas RLS.
- Tests de fase: RLS anon/auth/admin, no elevacion de role, constraints de totales, secuencia/funcion concurrency-safe de `order_number`.
- Dependencia: Fase 0.

Fase 2 - Backend checkout:

- Implementar DTOs y endpoint `POST /api/checkout`.
- Crear orden, snapshots, reservas y preferencia Mercado Pago.
- Implementar idempotencia global con `orders.idempotency_key` y `checkout_request_hash`.
- Manejar errores de proveedor y liberacion.
- Alinear expiracion de preferencia y reserva cuando Mercado Pago lo permita.
- Tests de fase: DTOs, `IDEMPOTENCY_CONFLICT`, stock insuficiente, dos checkouts por ultima unidad, error Mercado Pago despues de crear orden.
- Dependencia: Fase 1.

Fase 3 - Webhook seguro:

- Validar `x-signature`, `x-request-id`, `data.id`.
- Usar validador oficial del SDK de Mercado Pago o documentacion vigente al implementar.
- Guardar `payment_events`.
- Consultar API de Mercado Pago.
- Aplicar transiciones idempotentes.
- Resolver aprobaciones tardias despues del vencimiento: consumir reserva activa, readquirir stock si hay disponibilidad o marcar `order_status = on_hold` y `review_required = true` si no hay stock.
- Tests de fase: firma invalida, webhook repetido, webhook fuera de orden, approved tardio con stock, approved tardio sin stock, rejected, mismatch de importe/moneda.
- Dependencia: Fase 1 y Fase 2.

Fase 4 - Frontend checkout y resultado:

- Agregar datos de comprador y entrega/retiro en carrito.
- Guardar `orderId`, `orderNumber` y `statusAccessToken` en `sessionStorage` antes de redirigir.
- Consultar estado enviando `X-Order-Status-Token`; nunca poner token en `back_urls` ni query params.
- Consultar estado interno en success/failure/pending.
- Mantener checkout invitado y asociar `orders.user_id` solo si hay sesion.
- Tests de fase: checkout invitado, checkout con sesion, retorno success/failure/pending sin token en URL, estado interno via header.
- Dependencia: Fase 2 y endpoint de status.

Fase 5 - Admin comercial:

- Ordenes paginadas con payment/fulfillment/order status.
- Detalle de orden, items, datos de entrega y timeline de eventos.
- Acciones de fulfillment controladas.
- Solicitud administrativa de cancelacion/devolucion separada del resultado monetario real confirmado por proveedor.
- Tests de fase: admin lista y filtra ordenes, transiciones validas de fulfillment, bloqueo de `confirmed -> cancelled` con pago aprobado, devolucion solo con confirmacion de proveedor.
- Dependencia: Fase 3.

Fase 6 - Productos e inventario:

- Admin para SKU, stock, tracking, imagenes y ajustes.
- Movimientos de inventario auditables.
- Tests de fase: ajuste de stock auditado, productos sin stock controlado, low stock, imagenes y mutaciones admin protegidas.
- Dependencia: Fase 1.

Fase 7 - Calidad y redisenio:

- Completar cobertura transversal que no haya quedado en fases previas: e2e completos, accesibilidad, visual regression y performance.
- Extraer hooks y componentes presentacionales.
- Redisenio visual por flujo.
- Tests de fase: regresion visual responsive, e2e smoke completo, build/lint/typecheck.
- Dependencia: contratos comerciales estables.

## 17. Tests necesarios

Estos tests no deben quedar postergados a una fase final. Cada bloque debe implementarse en la misma fase que introduce el comportamiento correspondiente.

Unitarios:

- Validadores DTO de checkout.
- Calculo de totales y snapshots.
- Maquina de estados.
- Mapeo `ProductRow` a tipo frontend.
- `CartProvider`: agregar, quitar, cantidades, carga desde `localStorage`.

Integracion con mocks:

- `POST /api/checkout` crea orden/reserva/preferencia.
- Stock insuficiente devuelve 409.
- Error Mercado Pago libera o marca orden correctamente.
- Webhook firma invalida no procesa.
- Webhook aprobado consume reserva una vez.
- Webhook aprobado despues de reserva vencida readquiere stock si hay disponibilidad.
- Webhook aprobado despues de reserva vencida sin stock marca `order_status = on_hold`, `review_required = true` y `review_reason = 'late_approved_payment_no_stock'`.
- Webhook repetido no duplica movimiento.
- Webhook rejected libera reserva.
- Mismatch de importe/moneda no confirma.
- Endpoint status valida `X-Order-Status-Token` por header.

Base de datos:

- RLS anon no lee ordenes.
- Customer solo lee propias ordenes.
- Admin lee ordenes.
- Usuario no puede elevar `profiles.role`.
- RPC de reserva evita ultima unidad doble con transacciones concurrentes.

E2E:

- Catalogo a carrito a checkout mock aprobado.
- Checkout con delivery.
- Checkout con pickup.
- Resultado pending que luego pasa a approved.
- Admin ve orden y cambia fulfillment.
- Producto sin stock no permite compra.

## 18. Decisiones pendientes del propietario

| Decision | Recomendacion inicial | Estado |
| --- | --- | --- |
| Compra con cuenta o invitado | Arquitectura objetivo confirmada: checkout invitado permitido siempre; si hay sesion, asociar `orders.user_id`; nunca exigir registro para comprar. Falta definir si se promociona crear cuenta post-compra. | Parcialmente definido |
| Zonas de entrega | Empezar con zonas/manual por localidad/provincia simple. | Pendiente |
| Calculo de envio | MVP: tarifa fija o retiro gratis; evitar calculo complejo hasta confirmar zonas. | Pendiente |
| Direccion y horarios de retiro | Definir una ubicacion y ventanas visibles antes de checkout. | Pendiente |
| Duracion de reserva | 15 minutos iniciales. | Pendiente |
| Politica de cancelacion | Cancelacion sin costo antes de pago; despues de pago requiere flujo de devolucion. | Pendiente |
| Politica de devolucion | No reingresar stock hasta validar retorno fisico. | Pendiente |
| Productos sin stock controlado | Soportar `track_stock = false`, pero restringirlo a admins. | Pendiente |
| Datos fiscales | Para MVP pedir email/nombre/telefono; CUIT/DNI/factura A/B pendiente. | Pendiente |
| Notificaciones | Email o WhatsApp operativo despues de orden confirmada. | Pendiente |
| Retiro vs entrega por producto | Inicialmente ambos por orden completa; restricciones por producto despues. | Pendiente |

## 19. Criterios de aceptacion

Una fase comercial minima se considera aceptada cuando:

- El schema y RLS estan versionados.
- Antes de migrar se recupero y reviso baseline remoto: tablas, columnas, constraints, triggers y RLS existentes.
- Checkout crea una orden interna antes de Mercado Pago.
- `orders.idempotency_key` es unique global y `checkout_request_hash` detecta conflictos con `409 IDEMPOTENCY_CONFLICT`.
- `order_number` se genera con secuencia o funcion SQL concurrency-safe.
- `external_reference` contiene `orders.id`.
- `order_items` guarda snapshots de precio/nombre/imagen.
- La reserva de stock es atomica y evita doble compra de la ultima unidad.
- Expiracion de preferencia y reserva quedan alineadas cuando Mercado Pago lo permita.
- Webhook valida firma, `x-request-id` y `data.id`; interpreta/registra timestamp segun SDK/documentacion oficial.
- La validacion de firma usa SDK oficial o documentacion vigente de Mercado Pago; no hay ventana arbitraria inventada.
- Webhook consulta pago en Mercado Pago y valida referencia, importe y moneda.
- Eventos repetidos no duplican movimientos ni descuentos.
- Success/failure/pending consultan estado interno con token enviado por header desde `sessionStorage`, no por query param.
- Aprobacion posterior al vencimiento readquiere stock atomica si hay disponibilidad; si no hay stock, no confirma automaticamente y queda `on_hold` con revision auditada.
- Reservas vencidas, pagos rechazados y cancelaciones liberan stock.
- `confirmed -> cancelled` no ocurre mientras `payment_status = approved`; cancelacion/devolucion administrativa queda separada de confirmacion monetaria del proveedor.
- Admin puede ver ordenes con tres estados separados.
- No hay logs sensibles de sesion, payload completo o metadata de pago en cliente.
- Tests de checkout, webhook, stock y RLS existen en las fases donde se implementa cada comportamiento.

## 20. Riesgos y estrategia de rollback

Riesgos:

- Migracion de datos existentes sin schema conocido puede fallar por diferencias en columnas reales de Supabase.
- RLS mal aplicada puede bloquear admin o exponer datos.
- Transacciones de stock mal disenadas pueden generar overselling o stock retenido.
- Webhook mal validado puede rechazar eventos reales.
- Cambiar contratos de checkout puede romper `CartPage`.
- Pagos aprobados despues del vencimiento de reserva pueden dejar dinero cobrado sin stock disponible si no existe conciliacion.
- Reintentos de checkout sin idempotencia estricta pueden crear ordenes duplicadas o preferencias inconsistentes.
- Tokens de estado en URL pueden filtrarse por historial, logs o referers si se reintroducen en `back_urls`.
- Baseline remoto desconocido puede contener triggers/RLS manuales que una migracion ingenua podria romper.
- Redisenio antes del hardening puede duplicar trabajo.

Mitigacion:

- Recuperar baseline remoto antes de escribir migraciones y generar cambios incrementales.
- Crear migraciones incrementales y reversibles.
- Probar en ambiente staging con datos anonimizados.
- Mantener columnas actuales o vistas de compatibilidad durante una fase.
- Introducir nuevos endpoints sin eliminar los antiguos hasta pasar pruebas.
- Usar feature flag local/config para nuevo checkout.
- Registrar eventos y movimientos para auditoria.
- Guardar token de estado en `sessionStorage` y transmitirlo por header.
- Implementar conciliacion con `on_hold` y revision administrativa auditada para excepciones de pago aprobado sin stock.
- Alinear expiracion de preferencia y reserva cuando Mercado Pago lo permita.
- Ejecutar pruebas de concurrencia sobre reservas antes de produccion.

Rollback:

- Si falla checkout nuevo, el endpoint antiguo de preferencia solo puede permanecer temporalmente en desarrollo/staging. No debe usarse como fallback productivo porque no crea orden interna, no reserva stock y no valida el flujo completo.
- Si falla webhook nuevo, conservar eventos recibidos en `payment_events` y reprocesarlos con job/manual una vez corregido.
- Si falla migracion de UI admin, mantener `OrdersTable` vieja con alias derivado `status`.
- Si falla stock, pausar checkout y mantener catalogo visible con compra deshabilitada hasta reconciliar inventario.
- Si se detecta pago aprobado tardio sin stock, no confirmar orden por rollback automatico: dejar `order_status = on_hold`, `fulfillment_status = not_started`, `review_required = true`, contactar al cliente y ejecutar devolucion/propuesta alternativa segun politica aprobada.
- Si una migracion afecta RLS o triggers inesperados, revertir solo la migracion incremental aplicada y restaurar politicas desde baseline documentado.

## Refactorizacion previa al redisenio

Extraer antes de redisenar:

- `useCheckout` para envio, errores, order id/token y redireccion.
- `useOrderStatus` para success/failure/pending.
- `useProductsCatalog` para tienda y busqueda.
- `useAdminOrders` para listado/paginacion/filtros.
- `useAdminProducts` para CRUD e inventario.
- Componentes presentacionales: `ProductCard`, `ProductGallery`, `CartItemRow`, `CheckoutForm`, `OrderStatusPanel`, `OrderStatusBadges`, `AdminOrderTable`.

Componentes de mayor riesgo:

- `CartPage`: mezcla UI, calculo local y redireccion.
- `CartProvider`: contrato persistido en `localStorage` y validacion UUID.
- `api/create-preference.ts`: sera reemplazado por checkout real.
- `api/webhook.ts`: concentra seguridad e idempotencia.
- `OrdersTable`: asume `orders.status` unico e `items` JSON.
- `AdminProductsPage`: tendra que incorporar stock/SKU/imagenes sin volverse mas grande.

Migracion sin reescribir todo:

- Introducir tipos nuevos y mappers sin borrar los viejos.
- Mantener `imageUrl` y `price` en el contrato publico mientras se agregan campos.
- Cambiar backend primero, luego frontend checkout, luego admin.
- Mantener fallback local solo para demo, no para checkout real.
- Usar adaptadores para que datos actuales `products.image_url` sigan renderizando.
