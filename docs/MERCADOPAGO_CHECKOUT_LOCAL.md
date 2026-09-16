# Checkout Mercado Pago: contrato local

Este flujo no esta desplegado ni habilitado para cobrar. El navegador usa
`POST /api/checkout`; nunca llama RPC comerciales ni envia precio, moneda,
descuento, envio o estados.

## Rutas oficiales y pruebas

- `POST /api/checkout`: crea la orden y la preferencia.
- `POST /api/order-status`: consulta de invitado con token opaco.
- `POST /api/mercadopago/webhook`: unico webhook oficial de Mercado Pago.
- `GET /api/orders`: listado administrativo autenticado.

No existe compatibilidad para `/api/create-preference` ni `/api/webhook`.
Los contratos viven en `tests/api/commerce.contract.test.ts` y se ejecutan con
`npm run test:api`; deben permanecer fuera de `api/` para no ser funciones de
Vercel.

## Variables backend

- `MERCADOPAGO_ACCESS_TOKEN`
- `MERCADOPAGO_WEBHOOK_SECRET`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `COMMERCE_RATE_LIMIT_HASH_SECRET` (secreto aleatorio exclusivo del backend)
- `PUBLIC_SITE_URL` (HTTPS)
- `MERCADOPAGO_WEBHOOK_URL` (HTTPS)
- `ALLOWED_ORIGINS` (obligatoria en produccion)

No usar `VITE_` para secretos. Los placeholders de `.env.example` no son
credenciales.

## Limites y CORS

El rate limiter es persistente en PostgreSQL, atomico y fail-closed: si no se
puede validar una cuota, checkout y consulta de estado responden `503`. Nunca
usa memoria de proceso. La IP proviene exclusivamente de
`X-Vercel-Forwarded-For`, validada como una sola IP; no se acepta
`X-Forwarded-For`. Se almacena solamente un HMAC SHA-256 de la IP con
`COMMERCE_RATE_LIMIT_HASH_SECRET`.

- Checkout: 5 solicitudes por IP cada 10 minutos y 3 por idempotency key cada
  10 minutos. Ambas cuotas se consumen o rechazan juntas; `429` incluye
  `Retry-After`.
- Estado de orden: 20 consultas por IP cada minuto, con `429` generico y
  `Retry-After`.
- Las ventanas vencidas no afectan una ventana nueva. Un backend privilegiado
  debe ejecutar `purge_commerce_rate_limit_windows()` al menos diariamente;
  elimina ventanas de mas de 24 horas. La tabla no tiene grants para clientes.

Checkout y estado de invitado son endpoints exclusivos de navegador. Exigen
`Origin` y, en produccion, dicho valor debe figurar exactamente en
`ALLOWED_ORIGINS`; los requests sin Origin se rechazan. Esto solo es una
frontera de navegador/CORS, no autenticacion ni proteccion antiabuso: clientes
directos pueden falsificar Origin y siguen sujetos al rate limiter.

`order-status` acepta exclusivamente `POST application/json`, un body de hasta
512 bytes y el esquema exacto `{ "orderId": "uuid" }`; tambien exige un token
base64url de 43 caracteres. El body parser de Vercel queda deshabilitado para
que el limite se aplique a cuerpos chunked y sin `Content-Length`.

## Preferencias Mercado Pago

La preferencia tiene un lease SQL de 90 segundos: un solo proceso puede hacer
la llamada HTTP, los demas reciben estado en procesamiento o reutilizan la URL
guardada. No hay transaccion SQL abierta durante la llamada externa. La
referencia oficial vigente de `POST /checkout/preferences` no documenta
`X-Idempotency-Key`; aunque la SDK Node puede enviarlo en POST, el checkout no
depende de una semantica de idempotencia del proveedor no confirmada.

Si Mercado Pago acepta una preferencia pero falla la persistencia local, la
reserva no se libera y la orden pasa a reconciliacion: no hay reintento
automatico que pueda crear otra preferencia. Lo mismo ocurre con timeout o
lease vencido. Un backend operativo, tras consultar Preferences por
`external_reference`, debe usar `reconcile_mercadopago_preference_creation()`
para guardar la preferencia encontrada o, solo si confirma su ausencia,
reabrir el lease. Nunca se reemplaza una preferencia persistida ni se acepta un
`preference_id` del navegador.

## Operacion

- Excluir `ticket` en Checkout Pro; es el tipo de pago offline documentado por
  Mercado Pago.
- El redirect de `back_urls` solo muestra estado; el webhook firmado y la
  consulta server-to-server del pago son la fuente de verdad.
- El token de consulta de invitados se conserva solo en `sessionStorage` y se
  envia mediante `X-Order-Status-Token`; nunca se coloca en una URL.

## Nota sobre phase1c

`phase1c_privilege_hardening.sql` no fue modificado. En PostgreSQL 17.6 local
reproduce un segfault tanto con 105 aplicada como sin 105, en el bloque que
cambia a `anon` y captura la denegacion de ACL. No se atribuye a esta migracion
ni se desactiva para obtener una suite verde.
