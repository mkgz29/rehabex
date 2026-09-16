import {
  applyAdminCors,
  consumeRateLimit,
  isJsonContentType,
  logEvent,
  MAX_ORDER_STATUS_BODY_BYTES,
  readJsonBody,
  serviceClient,
  setRetryAfter,
  type ApiRequest,
  type ApiResponse,
} from '../../server/commerce/commerce.js';
import {
  createSupabasePaymentRepository,
  processMercadoPagoPayment,
  type MercadoPagoPayment,
  type PaymentProcessResult,
} from '../../server/commerce/paymentProcessing.js';

const PAYMENT_ID = /^[A-Za-z0-9_-]{1,256}$/;

type AdminServiceClient = {
  auth: { getUser: (token: string) => Promise<{ data: { user: { id: string; role?: string; app_metadata?: Record<string, unknown> } | null }; error: unknown }> };
  from: (table: string) => any;
  rpc: (name: string, input: Record<string, unknown>) => any;
};

type AuthorizationResult = { kind: 'admin'; userId: string } | { kind: 'unauthorized' | 'forbidden' };
type ProviderResult = { kind: 'ok'; payment: MercadoPagoPayment } | { kind: 'not_found' | 'unavailable' };

type ReconcileDependencies = {
  serviceClient: () => AdminServiceClient | null;
  authorize: (supabase: AdminServiceClient, token: string) => Promise<AuthorizationResult>;
  consumeRateLimit: (supabase: AdminServiceClient, request: ApiRequest, userId: string) => Promise<{ ok: boolean; retryAfter: number; unavailable: boolean }>;
  fetchPayment: (paymentId: string, accessToken: string) => Promise<ProviderResult>;
  processPayment: (supabase: AdminServiceClient, payment: MercadoPagoPayment) => Promise<PaymentProcessResult>;
};

export default createReconcilePaymentHandler();

export function createReconcilePaymentHandler(overrides: Partial<ReconcileDependencies> = {}) {
  const dependencies: ReconcileDependencies = {
    serviceClient: () => serviceClient() as AdminServiceClient | null,
    authorize: authenticateAdmin,
    consumeRateLimit: (supabase, request, userId) => consumeRateLimit(supabase as never, 'admin_reconcile', request, undefined, userId),
    fetchPayment: fetchMercadoPagoPayment,
    processPayment: (supabase, payment) => processMercadoPagoPayment(createSupabasePaymentRepository(supabase), payment, {
      dedupeSeed: 'admin-reconcile',
      requestId: null,
      requireTestMode: true,
    }),
    ...overrides,
  };

  return async function handler(request: ApiRequest, response: ApiResponse) {
    if (request.method === 'OPTIONS') {
      if (!applyAdminCors(request, response)) return response.status(403).json({ error: 'No autorizado.' });
      return response.status(204).end?.();
    }
    if (request.method !== 'POST') {
      response.setHeader?.('Allow', 'POST, OPTIONS');
      return response.status(405).json({ error: 'Metodo no permitido.' });
    }
    if (!applyAdminCors(request, response)) return response.status(403).json({ error: 'No autorizado.' });
    if (!isJsonContentType(request)) return response.status(415).json({ error: 'Solicitud invalida.' });
    const body = await readJsonBody(request, MAX_ORDER_STATUS_BODY_BYTES);
    const payload = body.ok ? parseReconcilePaymentPayload(body.value) : null;
    if (!payload) return response.status(400).json({ error: 'Solicitud invalida.' });

    const token = bearerToken(request.headers?.authorization);
    if (!token) return response.status(401).json({ error: 'No autorizado.' });
    const supabase = dependencies.serviceClient();
    if (!supabase) return response.status(503).json({ error: 'No disponible.' });
    const authorization = await dependencies.authorize(supabase, token);
    if (authorization.kind !== 'admin') return response.status(authorization.kind === 'unauthorized' ? 401 : 403).json({ error: 'No autorizado.' });

    const rateLimit = await dependencies.consumeRateLimit(supabase, request, authorization.userId);
    if (rateLimit.unavailable) return response.status(503).json({ error: 'No disponible.' });
    if (!rateLimit.ok) {
      setRetryAfter(response, rateLimit.retryAfter);
      return response.status(429).json({ error: 'Demasiadas solicitudes.' });
    }

    const accessToken = process.env.MERCADOPAGO_ACCESS_TOKEN;
    if (!accessToken) return response.status(503).json({ error: 'No disponible.' });
    const provider = await dependencies.fetchPayment(payload.paymentId, accessToken);
    if (provider.kind !== 'ok') return response.status(provider.kind === 'not_found' ? 404 : 503).json({ error: provider.kind === 'not_found' ? 'No se pudo reconciliar el pago.' : 'No disponible.' });

    const result = await dependencies.processPayment(supabase, provider.payment);
    if (result.kind === 'unavailable') return response.status(503).json({ error: 'No disponible.' });
    if (result.kind === 'rejected') {
      logEvent('admin_reconcile_rejected', { reason: result.reason });
      return response.status(409).json({ error: 'No se pudo reconciliar el pago.' });
    }
    logEvent(result.kind === 'duplicate' ? 'admin_reconcile_duplicate' : 'admin_reconcile_processed');
    return response.status(200).json({ received: true });
  };
}

export function parseReconcilePaymentPayload(value: unknown): { paymentId: string } | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const payload = value as Record<string, unknown>;
  if (Object.keys(payload).length !== 1 || typeof payload.paymentId !== 'string' || !PAYMENT_ID.test(payload.paymentId)) return null;
  return { paymentId: payload.paymentId };
}

async function authenticateAdmin(supabase: AdminServiceClient, token: string): Promise<AuthorizationResult> {
  const { data, error } = await supabase.auth.getUser(token);
  const user = data.user;
  if (error || !user || user.role === 'service_role' || user.app_metadata?.role === 'service_role') return { kind: 'unauthorized' };
  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .maybeSingle();
  if (profileError || !profile) return { kind: 'forbidden' };
  return profile.role === 'admin' ? { kind: 'admin', userId: user.id } : { kind: 'forbidden' };
}

async function fetchMercadoPagoPayment(paymentId: string, accessToken: string): Promise<ProviderResult> {
  try {
    const response = await fetch(`https://api.mercadopago.com/v1/payments/${encodeURIComponent(paymentId)}`, {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
    });
    if (response.status === 404) return { kind: 'not_found' };
    if (!response.ok) return { kind: 'unavailable' };
    return { kind: 'ok', payment: await response.json() as MercadoPagoPayment };
  } catch {
    return { kind: 'unavailable' };
  }
}

function bearerToken(value: string | string[] | undefined) {
  if (Array.isArray(value) || !value?.startsWith('Bearer ')) return null;
  const token = value.slice('Bearer '.length).trim();
  return token || null;
}
