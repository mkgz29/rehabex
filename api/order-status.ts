import {
  applyCors,
  consumeRateLimit,
  hash,
  header,
  isJsonContentType,
  logEvent,
  MAX_ORDER_STATUS_BODY_BYTES,
  readJsonBody,
  serviceClient,
  setRetryAfter,
  type ApiRequest,
  type ApiResponse,
} from './_commerce';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const STATUS_TOKEN = /^[A-Za-z0-9_-]{43}$/;

export const config = { api: { bodyParser: false } };

type OrderStatusDependencies = {
  serviceClient: typeof serviceClient;
  consumeRateLimit: typeof consumeRateLimit;
};

export function createOrderStatusHandler(dependencies: OrderStatusDependencies = { serviceClient, consumeRateLimit }) {
  return async function handler(request: ApiRequest, response: ApiResponse) {
  if (!applyCors(request, response)) return response.status(403).json({ error: 'Origen no permitido.' });
  if (request.method === 'OPTIONS') return response.status(204).end?.();
  if (request.method !== 'POST') {
    response.setHeader?.('Allow', 'POST, OPTIONS');
    return response.status(405).json({ error: 'Metodo no permitido.' });
  }
  if (!isJsonContentType(request)) return response.status(415).json({ error: 'Orden no encontrada.' });
  const parsed = await readJsonBody(request, MAX_ORDER_STATUS_BODY_BYTES);
  const orderId = parsed.ok ? parseOrderStatusPayload(parsed.value) : null;
  const token = header(request, 'x-order-status-token');
  if (!orderId || !token || !STATUS_TOKEN.test(token)) return response.status(404).json({ error: 'Orden no encontrada.' });
  const supabase = dependencies.serviceClient();
  if (!supabase) return response.status(503).json({ error: 'Servicio no disponible.' });

  const rateLimit = await dependencies.consumeRateLimit(supabase, 'order_status', request);
  if (rateLimit.unavailable) {
    logEvent('order_status_rate_limit_unavailable');
    return response.status(503).json({ error: 'Servicio no disponible.' });
  }
  if (!rateLimit.ok) {
    setRetryAfter(response, rateLimit.retryAfter);
    return response.status(429).json({ error: 'Orden no encontrada.' });
  }

  const { data, error } = await supabase
    .from('orders')
    .select('id, order_number, payment_status, order_status, fulfillment_status, total_amount, currency, refund_required, created_at')
    .eq('id', orderId)
    .eq('status_access_token_hash', hash(token))
    .maybeSingle();
  if (error || !data) {
    logEvent('order_status_denied');
    return response.status(404).json({ error: 'Orden no encontrada.' });
  }
  return response.status(200).json({ order: data });
  };
}

export default createOrderStatusHandler();

export function parseOrderStatusPayload(value: unknown): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const body = value as Record<string, unknown>;
  if (Object.keys(body).length !== 1 || Object.keys(body)[0] !== 'orderId') return null;
  const orderId = typeof body.orderId === 'string' ? body.orderId.trim() : '';
  return UUID.test(orderId) ? orderId : null;
}
