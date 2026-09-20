import { MercadoPagoConfig, Preference } from 'mercadopago';

import { createOrReusePreference, type PreferenceClaim } from '../server/commerce/preference.js';

import {
  applyCors,
  backendUrls,
  canonicalJson,
  classifyCheckoutUrl,
  consumeRateLimit,
  expectedEntryPoint,
  selectCheckoutEntryPoint,
  hash,
  header,
  isJsonContentType,
  logEvent,
  MAX_CHECKOUT_BODY_BYTES,
  mercadoPagoEnvironment,
  newLeaseToken,
  newStatusToken,
  readJsonBody,
  serviceClient,
  setRetryAfter,
  type ApiRequest,
  type ApiResponse,
} from '../server/commerce/commerce.js';

type CheckoutItem = { productId: string; quantity: number };
type CheckoutPayload = {
  items: CheckoutItem[];
  customer: { email: string; name: string; phone?: string };
  delivery: { method: 'pickup' | 'delivery'; recipientName?: string; phone?: string; addressLine1?: string; addressLine2?: string; city?: string; province?: string; postalCode?: string; notes?: string; pickupLocationLabel?: string; pickupWindow?: string };
};

type PreferenceItemRow = { product_id: string; product_name: string; quantity: number; unit_price: number | string };
type PreferenceBodyInput = {
  orderId: string;
  siteUrl: string;
  items: PreferenceItemRow[];
  reservationExpiresAt: string;
  createdAt?: Date;
};

export const config = { api: { bodyParser: false } };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export default async function handler(request: ApiRequest, response: ApiResponse) {
  if (!applyCors(request, response)) return response.status(403).json({ error: 'Origen no permitido.' });
  if (request.method === 'OPTIONS') return response.status(204).end?.();
  if (request.method !== 'POST') {
    response.setHeader?.('Allow', 'POST, OPTIONS');
    return response.status(405).json({ error: 'Metodo no permitido.' });
  }

  if (!isJsonContentType(request)) return response.status(415).json({ error: 'Content-Type no permitido.' });
  const body = await readJsonBody(request, MAX_CHECKOUT_BODY_BYTES);
  const payload = body.ok ? parseCheckoutPayload(body.value) : null;
  const idempotencyKey = header(request, 'idempotency-key');
  if (!payload) return response.status(400).json({ error: 'Solicitud de checkout invalida.' });
  if (!idempotencyKey || !UUID.test(idempotencyKey)) return response.status(400).json({ error: 'Idempotency-Key invalida.' });

  const supabase = serviceClient();
  const accessToken = process.env.MERCADOPAGO_ACCESS_TOKEN;
  if (!supabase || !accessToken) {
    logEvent('checkout_not_configured');
    return response.status(503).json({ error: 'Checkout no disponible.' });
  }

  const rateLimit = await consumeRateLimit(supabase, 'checkout', request, idempotencyKey);
  if (rateLimit.unavailable) {
    logEvent('checkout_rate_limit_unavailable');
    return response.status(503).json({ error: 'Checkout no disponible.' });
  }
  if (!rateLimit.ok) {
    setRetryAfter(response, rateLimit.retryAfter);
    return response.status(429).json({ error: 'Demasiadas solicitudes.' });
  }

  let urls: { site: string };
  try {
    urls = backendUrls();
  } catch {
    logEvent('checkout_urls_not_configured');
    return response.status(503).json({ error: 'Checkout no disponible.' });
  }

  // Mercado Pago's environment is explicit and independent from VERCEL_ENV.
  // Unset or unrecognised stops checkout rather than guessing which entry
  // point — and therefore which kind of money — the buyer would be sent to.
  const environment = mercadoPagoEnvironment();
  if (!environment) {
    logEvent('checkout_environment_not_configured');
    return response.status(503).json({ error: 'Checkout no disponible.' });
  }
  const entryPoint = expectedEntryPoint(environment);

  const requestHash = hash(canonicalJson({
    items: [...payload.items].sort((a, b) => a.productId.localeCompare(b.productId)),
    customer: payload.customer,
    delivery: payload.delivery,
  }));
  const statusToken = newStatusToken();

  // Releases holds whose checkout window already closed, so an abandoned attempt
  // stops counting against availability. Bounded and never fatal.
  try { await supabase.rpc('expire_stale_commerce_holds', { p_limit: 50 }); } catch { /* checkout proceeds regardless */ }
  const { data: created, error: orderError } = await supabase.rpc('create_checkout_order_v2', {
    p_idempotency_key: idempotencyKey,
    p_checkout_request_hash: requestHash,
    p_user_id: null,
    p_customer_email: payload.customer.email,
    p_customer_name: payload.customer.name,
    p_customer_phone: payload.customer.phone ?? null,
    p_delivery_method: payload.delivery.method,
    p_delivery_payload: payload.delivery,
    p_items: payload.items.map((item) => ({ product_id: item.productId, quantity: item.quantity })),
    p_status_access_token_hash: hash(statusToken),
    p_reservation_minutes: 15,
  });

  if (orderError || !Array.isArray(created) || created.length !== 1) {
    const conflict = orderError?.message.includes('IDEMPOTENCY_CONFLICT');
    logEvent('checkout_order_rejected', { conflict });
    return response.status(conflict ? 409 : 400).json({ error: conflict ? 'La clave ya fue usada con otro pedido.' : 'No se pudo crear la orden.' });
  }

  const orderId = String(created[0].order_id);
  // On a compatible retry, rotate the opaque guest token. The key is a random
  // UUID generated by the client and is checked again in this server-only query.
  // The environment is frozen onto the order here, before any preference
  // exists, so a later change of MERCADOPAGO_ENV can never reclassify it.
  const { error: tokenError } = await supabase.from('orders').update({ status_access_token_hash: hash(statusToken), payment_environment: environment }).eq('id', orderId).eq('idempotency_key', idempotencyKey);
  if (tokenError) {
    logEvent('checkout_token_rotation_failed');
    return response.status(503).json({ error: 'Checkout no disponible.' });
  }

  const { data: order, error: readError } = await supabase
    .from('orders')
    .select('id, external_reference, total_amount, currency, reservation_expires_at, mercadopago_preference_id, mercadopago_checkout_url, order_items(product_id, product_name, quantity, unit_price, currency)')
    .eq('id', orderId)
    .single();
  if (readError || !order || order.external_reference !== orderId || order.currency !== 'ARS') {
    logEvent('checkout_order_read_failed');
    return response.status(500).json({ error: 'No se pudo preparar el checkout.' });
  }

  if (order.mercadopago_preference_id && order.mercadopago_checkout_url) {
    return response.status(200).json({ checkoutUrl: order.mercadopago_checkout_url, orderId, statusToken });
  }

  const leaseToken = newLeaseToken();
  const preferenceResult = await createOrReusePreference({
    async claim(token) {
      const { data, error } = await supabase.rpc('claim_mercadopago_preference_creation', {
        p_order_id: orderId, p_lease_token: token, p_lease_seconds: 90,
      });
      return !error && Array.isArray(data) && data.length === 1 ? data[0] as PreferenceClaim : null;
    },
    async complete(token, preferenceId, checkoutUrl) {
      const { data, error } = await supabase.rpc('complete_mercadopago_preference_creation', {
        p_order_id: orderId, p_lease_token: token, p_preference_id: preferenceId, p_checkout_url: checkoutUrl,
      });
      return !error && Array.isArray(data) && data.length === 1 ? data[0] as PreferenceClaim : null;
    },
    async fail(token) {
      await supabase.rpc('fail_mercadopago_preference_creation', {
        p_order_id: orderId, p_lease_token: token, p_error_code: 'provider_or_persistence_failure',
      });
    },
  }, {
    async create() {
      const preference = new Preference(new MercadoPagoConfig({ accessToken }));
      const response = await preference.create({
        body: buildPreferenceBody({
          orderId,
          siteUrl: urls.site,
          items: order.order_items ?? [],
          reservationExpiresAt: order.reservation_expires_at,
        }),
      });
      const selected = selectCheckoutEntryPoint(environment, response);
      if (!selected) {
        logEvent('checkout_entry_point_invalid', {
          checkoutMode: environment,
          checkoutEntryPoint: entryPoint,
          resolvedEntryPoint: classifyCheckoutUrl(entryPoint === 'sandbox' ? response.sandbox_init_point : response.init_point) ?? 'none',
        });
        throw new Error('checkout entry point unavailable for the configured environment');
      }
      logEvent('checkout_entry_point_selected', { checkoutMode: environment, checkoutEntryPoint: selected.entryPoint });
      return { id: response.id, checkoutUrl: selected.checkoutUrl };
    },
  }, leaseToken);

  if (preferenceResult.status === 'processing') {
    setRetryAfter(response, 5);
    return response.status(409).json({ error: 'El checkout se esta preparando. Reintenta en unos segundos.' });
  }
  if (preferenceResult.status === 'reconciliation_required') {
    logEvent('checkout_preference_reconciliation_required');
    return response.status(503).json({ error: 'Checkout no disponible.' });
  }
  if (preferenceResult.status === 'ready') {
    logEvent('checkout_preference_created', { orderId, checkoutMode: environment, checkoutEntryPoint: entryPoint });
    return response.status(200).json({ checkoutUrl: preferenceResult.checkoutUrl, orderId, statusToken });
  }
  logEvent('checkout_preference_failed', { orderId });
  return response.status(502).json({ error: 'No se pudo iniciar el checkout.' });
}

/**
 * Body of a Checkout Pro preference.
 *
 * It intentionally carries no notification_url: Mercado Pago documents that a URL
 * sent at payment creation takes priority over the one configured in "Tus
 * integraciones", and only that panel channel delivers webhooks signed with the
 * panel secret. Sending one here downgrades the integration to the IPN channel,
 * whose x-signature cannot be validated with that secret.
 */
export function buildPreferenceBody(input: PreferenceBodyInput) {
  return {
    external_reference: input.orderId,
    items: input.items.map((item) => ({
      id: item.product_id, title: item.product_name, quantity: item.quantity,
      unit_price: Number(item.unit_price), currency_id: 'ARS',
    })),
    back_urls: { success: `${input.siteUrl}/success`, failure: `${input.siteUrl}/failure`, pending: `${input.siteUrl}/pending` },
    auto_return: 'approved', expires: true,
    expiration_date_from: (input.createdAt ?? new Date()).toISOString(),
    expiration_date_to: new Date(input.reservationExpiresAt).toISOString(),
    payment_methods: { excluded_payment_types: [{ id: 'ticket' }] },
  };
}

export function parseCheckoutPayload(value: unknown): CheckoutPayload | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  if (Object.keys(input).some((key) => !['items', 'customer', 'delivery'].includes(key))) return null;
  if (!Array.isArray(input.items) || input.items.length < 1 || input.items.length > 20) return null;
  const ids = new Set<string>();
  const items: CheckoutItem[] = [];
  for (const raw of input.items) {
    if (!raw || typeof raw !== 'object') return null;
    const item = raw as Record<string, unknown>;
    if (Object.keys(item).some((key) => !['productId', 'quantity'].includes(key))) return null;
    const productId = typeof item.productId === 'string' ? item.productId.trim() : '';
    if (!UUID.test(productId) || typeof item.quantity !== 'number' || !Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 20 || ids.has(productId)) return null;
    ids.add(productId); items.push({ productId, quantity: item.quantity });
  }
  const customerInput = asObject(input.customer);
  const deliveryInput = asObject(input.delivery);
  if (!customerInput || !deliveryInput) return null;
  const email = stringField(customerInput.email, 254);
  const name = stringField(customerInput.name, 120);
  const phone = stringField(customerInput.phone, 40);
  const method = deliveryInput.method === 'pickup' || deliveryInput.method === 'delivery' ? deliveryInput.method : null;
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !name || !phone || !method) return null;
  const delivery: CheckoutPayload['delivery'] = {
    method: method as 'pickup' | 'delivery',
    recipientName: optionalString(deliveryInput.recipientName, 120), phone: optionalString(deliveryInput.phone, 40),
    addressLine1: optionalString(deliveryInput.addressLine1, 160), addressLine2: optionalString(deliveryInput.addressLine2, 160),
    city: optionalString(deliveryInput.city, 100), province: optionalString(deliveryInput.province, 100),
    postalCode: optionalString(deliveryInput.postalCode, 24), notes: optionalString(deliveryInput.notes, 500),
    pickupLocationLabel: optionalString(deliveryInput.pickupLocationLabel, 120), pickupWindow: optionalString(deliveryInput.pickupWindow, 120),
  };
  if (method === 'delivery' && (!delivery.recipientName || !delivery.addressLine1 || !delivery.city || !delivery.province || !delivery.postalCode)) return null;
  return { items, customer: { email: email.toLowerCase(), name, phone }, delivery };
}

function asObject(value: unknown) { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null; }
function stringField(value: unknown, max: number) { return typeof value === 'string' && value.trim().length > 0 && value.trim().length <= max ? value.trim() : null; }
function optionalString(value: unknown, max: number) { return value === undefined ? undefined : stringField(value, max) ?? undefined; }
