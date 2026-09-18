import { logEvent, serviceClient, type ApiRequest, type ApiResponse } from '../server/commerce/commerce.js';

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
  'mercadopago_payment_id',
  'mercadopago_preference_id',
  'review_required',
  'review_reason',
  'refund_required',
  'order_items(product_name, quantity, unit_price)',
].join(', ');

const MAX_ORDERS = 200;

export default async function handler(request: ApiRequest, response: ApiResponse) {
  if (request.method !== 'GET') {
    response.setHeader?.('Allow', 'GET');
    return response.status(405).json({ error: 'Metodo no permitido.' });
  }

  const supabase = serviceClient();
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

function bearerToken(value: string | string[] | undefined) {
  const header = Array.isArray(value) ? value[0] : value;
  if (!header?.startsWith('Bearer ')) return null;
  return header.slice('Bearer '.length).trim() || null;
}
