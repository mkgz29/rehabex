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
import { fetchMercadoPagoPayment, type MercadoPagoProviderResult } from '../../server/commerce/mercadoPagoPayment.js';

const PAYMENT_ID = /^[A-Za-z0-9_-]{1,256}$/;

export const config = { api: { bodyParser: false } };

type AdminServiceClient = {
  auth: { getUser: (token: string) => Promise<{ data: { user: { id: string; role?: string; app_metadata?: Record<string, unknown> } | null }; error: unknown }> };
  from: (table: string) => any;
  rpc: (name: string, input: Record<string, unknown>) => any;
};

type AuthorizationResult = { kind: 'admin'; userId: string } | { kind: 'unauthorized' | 'forbidden' };
type ReconciliationStage = 'rate_limit' | 'payment_fetch' | 'payment_parse' | 'merchant_order_fetch' | 'merchant_order_parse' | 'atomic_rpc';
type ReconcileDependencies = {
  serviceClient: () => AdminServiceClient | null;
  authorize: (supabase: AdminServiceClient, token: string) => Promise<AuthorizationResult>;
  consumeRateLimit: (supabase: AdminServiceClient, request: ApiRequest, userId: string) => Promise<{ ok: boolean; retryAfter: number; unavailable: boolean }>;
  fetchPayment: (paymentId: string, accessToken: string) => Promise<MercadoPagoProviderResult>;
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
      requestId: null,
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
    if (body.ok === false) return response.status(body.reason === 'invalid' ? 400 : 413).json({ error: 'Solicitud invalida.' });
    const payload = parseReconcilePaymentPayload(body.value);
    if (!payload) return response.status(400).json({ error: 'Solicitud invalida.' });

    const token = bearerToken(request.headers?.authorization);
    if (!token) return response.status(401).json({ error: 'No autorizado.' });
    const supabase = dependencies.serviceClient();
    if (!supabase) {
      logReconciliationFailure('atomic_rpc', 'service_client_unavailable', true);
      return response.status(503).json({ error: 'No disponible.' });
    }
    const authorization = await dependencies.authorize(supabase, token);
    if (authorization.kind !== 'admin') return response.status(authorization.kind === 'unauthorized' ? 401 : 403).json({ error: 'No autorizado.' });

    let rateLimit: { ok: boolean; retryAfter: number; unavailable: boolean };
    try {
      rateLimit = await dependencies.consumeRateLimit(supabase, request, authorization.userId);
    } catch {
      logReconciliationFailure('rate_limit', 'rate_limit_internal_error', true);
      return response.status(503).json({ error: 'No disponible.' });
    }
    if (rateLimit.unavailable) {
      logReconciliationFailure('rate_limit', 'rate_limit_unavailable', true);
      return response.status(503).json({ error: 'No disponible.' });
    }
    if (!rateLimit.ok) {
      logReconciliationFailure('rate_limit', 'rate_limit_exceeded');
      setRetryAfter(response, rateLimit.retryAfter);
      return response.status(429).json({ error: 'Demasiadas solicitudes.' });
    }

    const accessToken = process.env.MERCADOPAGO_ACCESS_TOKEN;
    if (!accessToken) {
      logReconciliationFailure('payment_fetch', 'provider_not_configured', true);
      return response.status(503).json({ error: 'No disponible.' });
    }
    let provider: MercadoPagoProviderResult;
    try {
      provider = await dependencies.fetchPayment(payload.paymentId, accessToken);
    } catch {
      logReconciliationFailure('payment_fetch', 'provider_payment_network_error', true);
      return response.status(503).json({ error: 'No disponible.' });
    }
    if (provider.kind !== 'ok') {
      const stage = reconciliationStage(provider.stage) ?? 'payment_fetch';
      logReconciliationFailure(stage, provider.errorCode, provider.kind === 'unavailable', provider.httpStatus);
      return response.status(provider.kind === 'not_found' ? 404 : 503).json({ error: provider.kind === 'not_found' ? 'No se pudo reconciliar el pago.' : 'No disponible.' });
    }

    let result: PaymentProcessResult;
    try {
      result = await dependencies.processPayment(supabase, provider.payment);
    } catch {
      logReconciliationFailure('atomic_rpc', 'atomic_rpc_error', true);
      return response.status(503).json({ error: 'No disponible.' });
    }
    if (result.kind === 'unavailable') {
      logReconciliationFailure('atomic_rpc', 'atomic_rpc_unavailable', true);
      return response.status(503).json({ error: 'No disponible.' });
    }
    if (result.kind === 'rejected') {
      logReconciliationFailure('atomic_rpc', result.reason);
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

function bearerToken(value: string | string[] | undefined) {
  if (Array.isArray(value) || !value?.startsWith('Bearer ')) return null;
  const token = value.slice('Bearer '.length).trim();
  return token || null;
}

function logReconciliationFailure(stage: ReconciliationStage, errorCode: string, isUnavailable = false, providerHttpStatus?: number) {
  const context: Record<string, string | number | boolean | undefined> = {
    stage,
    errorCode: safeInternalErrorCode(errorCode),
  };
  if (isProviderHttpStatus(providerHttpStatus)) context.providerHttpStatus = providerHttpStatus;
  // The only dynamic values retained here are an allowlisted stage and an HTTP
  // status. Do not include request identifiers, URLs, tokens, payloads or
  // provider responses in reconciliation telemetry.
  logEvent(isUnavailable ? 'admin_reconcile_503' : 'admin_reconcile_failed', context);
}

function reconciliationStage(value: unknown): ReconciliationStage | null {
  return value === 'rate_limit' || value === 'payment_fetch' || value === 'payment_parse'
    || value === 'merchant_order_fetch' || value === 'merchant_order_parse' || value === 'atomic_rpc'
    ? value
    : null;
}

function safeInternalErrorCode(value: unknown) {
  return typeof value === 'string' && /^[a-z0-9_]{1,80}$/.test(value) ? value : 'reconciliation_error';
}

function isProviderHttpStatus(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 100 && value <= 599;
}
