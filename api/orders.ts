import { logEvent, serviceClient, type ApiRequest, type ApiResponse } from '../server/commerce/commerce.js';
import { UUID } from '../server/admin/validators.js';

// Explicit projection. `select('*')` previously shipped the guest status token
// hash, the preference lease token, the idempotency key and the full delivery
// address to the browser. Operations needs identity, money and state — not
// authentication material, and not every personal field.
const ORDER_COLUMNS = [
  'id',
  'order_number',
  'created_at',
  'paid_at',
  'payment_status',
  'order_status',
  'fulfillment_status',
  'total_amount',
  'currency',
  'delivery_method',
  'customer_email',
  'customer_name',
  'customer_phone',
  'mercadopago_payment_id',
  'mercadopago_preference_id',
  'review_required',
  'review_reason',
  'refund_required',
  'order_items(product_name, quantity, unit_price)',
].join(', ');

const MAX_ORDERS = 200;

type OrdersDependencies = { serviceClient: typeof serviceClient };
const defaultDependencies: OrdersDependencies = { serviceClient };

// The optional third parameter exists only for tests to inject a fake
// Supabase client; Vercel always invokes this with exactly (request,
// response), so production behavior is unchanged.
export default async function handler(request: ApiRequest, response: ApiResponse, deps: OrdersDependencies = defaultDependencies) {
  if (request.method !== 'GET') {
    response.setHeader?.('Allow', 'GET');
    return response.status(405).json({ error: 'Metodo no permitido.' });
  }

  const supabase = deps.serviceClient();
  if (!supabase) {
    logEvent('orders_not_configured');
    return response.status(503).json({ error: 'Orders API no esta configurada.' });
  }

  const token = bearerToken(request.headers?.authorization);
  if (!token) return response.status(401).json({ error: 'No autorizado.' });

  const { data: userData, error: userError } = await supabase.auth.getUser(token);
  const user = userData?.user;
  if (userError || !user) {
    logEvent('orders_unauthorized');
    return response.status(401).json({ error: 'No autorizado.' });
  }

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .maybeSingle();
  if (profileError || profile?.role !== 'admin') {
    logEvent('orders_forbidden');
    return response.status(403).json({ error: 'No autorizado.' });
  }

  // Optional, single-purpose lookup: a specific order by id, regardless of
  // where it falls in the MAX_ORDERS most-recent window below. No other
  // filter is accepted -- this is not a general query surface.
  const id = singleQueryValue(request.query?.id);
  if (id !== undefined) {
    if (!UUID.test(id)) return response.status(400).json({ error: 'Solicitud invalida.' });

    const { data, error } = await supabase.from('orders').select(ORDER_COLUMNS).eq('id', id).maybeSingle();
    if (error) {
      logEvent('orders_query_failed');
      return response.status(503).json({ error: 'No se pudieron obtener las ordenes.' });
    }
    if (!data) return response.status(404).json({ error: 'No encontrado.' });

    return response.status(200).json({ orders: [data] });
  }

  const { data, error } = await supabase
    .from('orders')
    .select(ORDER_COLUMNS)
    .order('created_at', { ascending: false })
    .limit(MAX_ORDERS);
  if (error) {
    logEvent('orders_query_failed');
    return response.status(503).json({ error: 'No se pudieron obtener las ordenes.' });
  }

  return response.status(200).json({ orders: data ?? [] });
}

function singleQueryValue(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

function bearerToken(value: string | string[] | undefined) {
  const header = Array.isArray(value) ? value[0] : value;
  if (!header?.startsWith('Bearer ')) return null;
  return header.slice('Bearer '.length).trim() || null;
}
