# Commerce Phase 0 decisions - Rehabex

Fecha: 2026-09-11

Alcance: decisiones minimas para disenar migraciones incrementales de Fase 1B. No se implementa checkout, webhook, frontend ni cambios remotos en esta fase.

## Decisiones cerradas

| Decision | Definicion Fase 0 | Impacto en Fase 1B |
| --- | --- | --- |
| Modelo de compra | Checkout invitado permitido siempre. Si hay sesion valida, asociar `orders.user_id`; nunca exigir registro para comprar. | `orders.user_id` nullable; datos de comprador quedan como snapshot obligatorio en la orden. |
| Cuenta post-compra | Opcional y posterior a la compra. No bloquear checkout por registro. | `profiles` soporta `customer`, pero checkout no depende de perfil existente. |
| Metodos de entrega | MVP soporta `pickup` y `delivery` a nivel de orden completa. | Crear enum `delivery_method`; datos de pickup/delivery viven en `orders`. |
| Restricciones por producto | No se modelan restricciones de entrega por producto en MVP. | Evitar tabla/reglas por producto en Fase 1B; dejar extension futura. |
| Zonas de entrega | Operacion manual/configurable por localidad/provincia. Sin calculo automatico complejo en DB. | Guardar ciudad/provincia/codigo postal y monto de envio; no crear motor de tarifas aun. |
| Calculo de envio | MVP usa tarifa fija o monto manual calculado por backend. Retiro puede ser gratis. | `shipping_amount` numeric default 0 y constraints de no negativo. |
| Datos de comprador | Requerir email y nombre; telefono recomendado y guardado si se provee. | `customer_email` y `customer_name` not null; `customer_phone` nullable. |
| Datos fiscales | No exigir CUIT/DNI para MVP. Reservar extension futura si se define facturacion formal. | No crear columnas fiscales en Fase 1B salvo metadata futura controlada. |
| Reserva de stock | 15 minutos iniciales. | `reservation_expires_at`; `stock_reservations.expires_at`; funciones deben aceptar/usar ventana de 15 minutos. |
| Control de stock | `track_stock = true` por defecto; `allow_backorder = false` por defecto. | Agregar columnas de inventario en `products` con constraints. |
| Productos sin stock controlado | Permitidos solo por decision admin explicita (`track_stock = false`). Backorder deshabilitado por defecto. | Policies/RPC deben impedir que clientes activen bypass de stock. |
| Pago aprobado tardio | Si la reserva vencio, intentar readquirir stock atomicamente; si no alcanza, dejar orden `on_hold` con revision. | Requiere estados separados y `review_required/review_reason`. |
| Cancelacion | Antes de pago aprobado: liberar reserva y cancelar. Con pago aprobado: registrar solicitud y esperar confirmacion del proveedor para refund/cancelacion monetaria. | Separar `cancellation_requested_*` de estados finales. |
| Devolucion | No reingresar stock automaticamente hasta validar retorno fisico o decision admin auditada. | `inventory_movements` soporta `return`; no automatizar por webhook de refund. |
| Notificaciones | MVP operativo: email y/o WhatsApp manual despues de orden confirmada. Automatizacion queda fuera de Fase 1B. | No crear tabla de notificaciones aun; mantener campos de contacto en `orders`. |
| Estados | Separar `payment_status`, `fulfillment_status` y `order_status`. | Crear enums/checks y mantener compatibilidad temporal con `orders.status`. |
| Identificador de orden | Generar `order_number` con secuencia o funcion transaccional, no con `count(*)`. | Crear secuencia/funcion local testeable. |
| Idempotencia | `POST /api/checkout` debe exigir `idempotency_key` y guardar `checkout_request_hash`. | Unique global en `orders.idempotency_key`; hash not null para nuevas ordenes. |
| Estado para invitado | Token opaco solo en respuesta inicial y `sessionStorage`; nunca en URL. Guardar hash en DB. | `status_access_token_hash` not null para nuevas ordenes. |

## Fuera de alcance por ahora

- Calculo automatico de tarifas por distancia/zona.
- Direcciones reutilizables por cuenta.
- Facturacion fiscal avanzada.
- Variantes de producto.
- Galeria completa obligatoria antes de stock.
- Automatizacion de emails/WhatsApp.
- Cambios de frontend, checkout o webhook.

## Criterio para pasar a Fase 1B

Las migraciones deben ser incrementales, compatibles con el schema real y probadas localmente. No deben dropear ni recrear objetos existentes. Las columnas nuevas obligatorias para ordenes productivas deben agregarse de forma compatible con historico existente, usando defaults, nullable temporal o backfill controlado cuando corresponda.
