import type { MercadoPagoPayment } from './paymentProcessing.js';

type MercadoPagoPaymentResponse = {
  id?: unknown;
  status?: unknown;
  transaction_amount?: unknown;
  currency_id?: unknown;
  external_reference?: unknown;
  preference_id?: unknown;
  live_mode?: unknown;
  order?: { id?: unknown } | null;
};

type MercadoPagoMerchantOrderResponse = { preference_id?: unknown };
type MercadoPagoSearchResponse = { paging?: { total?: unknown } | null; results?: unknown };

type FetchResponse = { ok: boolean; status: number; json: () => Promise<unknown> };
type FetchPayment = (input: string, init: { headers: Record<string, string> }) => Promise<FetchResponse>;

/**
 * How `preference_id` was obtained for a payment.
 *
 * The official Payment contract does not declare `preference_id` (the SDK's
 * `PaymentResponse` exposes only `order` and `external_reference`), and this
 * integration's access token is not authorized for `/merchant_orders`
 * (observed HTTP 403). `unresolved` is therefore an expected outcome, and the
 * caller binds the payment to the order through `external_reference` instead.
 */
export type PreferenceBinding = 'payment' | 'merchant_order' | 'unresolved';

export type MercadoPagoProviderResult =
  | { kind: 'ok'; payment: MercadoPagoPayment; preferenceBinding: PreferenceBinding; liveModeFieldPresent: boolean }
  | MercadoPagoProviderFailure;

/**
 * Coarse classification of the configured access token's prefix.
 *
 * Non-authoritative on purpose: Mercado Pago documents that a test access
 * token carries the same APP_USR prefix as a production one, so this can never
 * decide the environment. `live_mode` on the payment is the authoritative
 * signal. Recorded only to correlate a misconfiguration; never the value.
 */
export function credentialMode(accessToken: string | undefined): 'app_usr_prefixed' | 'test_prefixed' | 'other_prefix' | 'absent' {
  if (!accessToken) return 'absent';
  if (accessToken.startsWith('APP_USR-')) return 'app_usr_prefixed';
  if (accessToken.startsWith('TEST-')) return 'test_prefixed';
  return 'other_prefix';
}

export type MercadoPagoProviderStage = 'payment_fetch' | 'payment_parse' | 'merchant_order_fetch' | 'merchant_order_parse' | 'payment_search' | 'payment_search_parse';

export type MercadoPagoProviderFailure = {
  kind: 'not_found' | 'unavailable';
  stage: MercadoPagoProviderStage;
  errorCode: string;
  httpStatus?: number;
};

export type MercadoPagoSearchResult =
  | { kind: 'ok'; payments: MercadoPagoPayment[] }
  | MercadoPagoProviderFailure;

/**
 * Keeps the provider payload at the boundary and passes the payment processor
 * one canonical DTO only.
 *
 * `preference_id` is best effort: it is read from the payment when present,
 * then from the documented merchant order, and is left undefined when neither
 * is available. Merchant-order failures are never fatal — a 403 there used to
 * fail every real Checkout Pro notification with HTTP 502.
 */
export async function fetchMercadoPagoPayment(
  paymentId: string,
  accessToken: string,
  fetchPayment: FetchPayment = fetch,
): Promise<MercadoPagoProviderResult> {
  let paymentResponse: FetchResponse;
  try {
    paymentResponse = await fetchPayment(`https://api.mercadopago.com/v1/payments/${encodeURIComponent(paymentId)}`, requestOptions(accessToken));
  } catch {
    return providerUnavailable('payment_fetch', 'provider_payment_network_error');
  }
  if (paymentResponse.status === 404) return providerFailure('not_found', 'payment_fetch', 'provider_payment_not_found', 404);
  if (!paymentResponse.ok) return providerUnavailable('payment_fetch', 'provider_payment_http_error', paymentResponse.status);

  let payment: MercadoPagoPaymentResponse;
  try {
    payment = requiredPaymentResponse(await paymentResponse.json());
  } catch {
    return providerUnavailable('payment_parse', 'provider_payment_parse_error', paymentResponse.status);
  }

  let preferenceId = nonEmptyString(payment.preference_id);
  let preferenceBinding: PreferenceBinding = preferenceId ? 'payment' : 'unresolved';
  if (!preferenceId) {
    const merchantOrderId = merchantOrderIdFor(payment);
    if (merchantOrderId) {
      const resolved = await merchantOrderPreference(merchantOrderId, accessToken, fetchPayment);
      if (resolved) {
        preferenceId = resolved;
        preferenceBinding = 'merchant_order';
      }
    }
  }

  // Distinguishes "the provider said false" from "the provider never sent the
  // field", which the DTO alone collapses into the same undefined.
  const liveModeFieldPresent = Object.prototype.hasOwnProperty.call(payment, 'live_mode') && payment.live_mode !== null;
  return { kind: 'ok', payment: adaptMercadoPagoPayment(payment, preferenceId), preferenceBinding, liveModeFieldPresent };
}

/**
 * Official payment search (`GET /v1/payments/search`, SDK `Payment.search`).
 *
 * The access token scopes the search to this collector, so a result carrying
 * our own order UUID as `external_reference` is an authoritative match. Used by
 * the recovery path when a signed webhook never arrives.
 */
export async function searchMercadoPagoPaymentsByExternalReference(
  externalReference: string,
  accessToken: string,
  fetchPayment: FetchPayment = fetch,
): Promise<MercadoPagoSearchResult> {
  const url = `https://api.mercadopago.com/v1/payments/search?sort=date_created&criteria=desc&external_reference=${encodeURIComponent(externalReference)}`;
  let searchResponse: FetchResponse;
  try {
    searchResponse = await fetchPayment(url, requestOptions(accessToken));
  } catch {
    return providerUnavailable('payment_search', 'provider_payment_search_network_error');
  }
  if (!searchResponse.ok) return providerUnavailable('payment_search', 'provider_payment_search_http_error', searchResponse.status);

  let body: MercadoPagoSearchResponse;
  try {
    body = asSearchResponse(await searchResponse.json());
  } catch {
    return providerUnavailable('payment_search_parse', 'provider_payment_search_parse_error', searchResponse.status);
  }
  if (!Array.isArray(body.results)) return providerUnavailable('payment_search_parse', 'provider_payment_search_shape_invalid', searchResponse.status);

  const payments: MercadoPagoPayment[] = [];
  for (const entry of body.results) {
    const candidate = asPaymentResponse(entry);
    // Summaries missing a required field can never be validated; drop them here
    // rather than letting an incomplete DTO reach the atomic processor.
    if (!identifier(candidate.id) || typeof candidate.status !== 'string' || typeof candidate.external_reference !== 'string') continue;
    payments.push(adaptMercadoPagoPayment(candidate, nonEmptyString(candidate.preference_id)));
  }
  return { kind: 'ok', payments };
}

export function adaptMercadoPagoPayment(payload: unknown, resolvedPreferenceId?: string): MercadoPagoPayment {
  const payment = asPaymentResponse(payload);
  return {
    id: identifier(payment.id),
    status: typeof payment.status === 'string' ? payment.status : undefined,
    transaction_amount: typeof payment.transaction_amount === 'number' || typeof payment.transaction_amount === 'string' ? payment.transaction_amount : undefined,
    currency_id: typeof payment.currency_id === 'string' ? payment.currency_id : undefined,
    external_reference: typeof payment.external_reference === 'string' ? payment.external_reference : undefined,
    preference_id: nonEmptyString(payment.preference_id) ?? resolvedPreferenceId,
    live_mode: typeof payment.live_mode === 'boolean' ? payment.live_mode : undefined,
  };
}

async function merchantOrderPreference(merchantOrderId: string, accessToken: string, fetchPayment: FetchPayment) {
  let response: FetchResponse;
  try {
    response = await fetchPayment(`https://api.mercadopago.com/merchant_orders/${encodeURIComponent(merchantOrderId)}`, requestOptions(accessToken));
  } catch {
    return null;
  }
  if (!response.ok) return null;
  try {
    return nonEmptyString(asMerchantOrderResponse(await response.json()).preference_id) ?? null;
  } catch {
    return null;
  }
}

function requestOptions(accessToken: string) {
  return { headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' } };
}

function asPaymentResponse(value: unknown): MercadoPagoPaymentResponse {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as MercadoPagoPaymentResponse : {};
}

function asMerchantOrderResponse(value: unknown): MercadoPagoMerchantOrderResponse {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as MercadoPagoMerchantOrderResponse : {};
}

function asSearchResponse(value: unknown): MercadoPagoSearchResponse {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as MercadoPagoSearchResponse : {};
}

function requiredPaymentResponse(value: unknown) {
  const payment = asPaymentResponse(value);
  if (!identifier(payment.id)
    || typeof payment.status !== 'string'
    || (typeof payment.transaction_amount !== 'number' && typeof payment.transaction_amount !== 'string')
    || typeof payment.currency_id !== 'string'
    || typeof payment.external_reference !== 'string') {
    throw new Error('invalid provider payment response');
  }
  return payment;
}

function providerUnavailable(stage: MercadoPagoProviderStage, errorCode: string, httpStatus?: number): MercadoPagoProviderFailure {
  return providerFailure('unavailable', stage, errorCode, httpStatus);
}

function providerFailure(kind: MercadoPagoProviderFailure['kind'], stage: MercadoPagoProviderStage, errorCode: string, httpStatus?: number): MercadoPagoProviderFailure {
  return { kind, stage, errorCode, ...(validHttpStatus(httpStatus) ? { httpStatus } : {}) };
}

function validHttpStatus(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 100 && value <= 599;
}

function merchantOrderIdFor(payment: MercadoPagoPaymentResponse) {
  return payment.order && typeof payment.order === 'object' ? identifier(payment.order.id) : undefined;
}

function identifier(value: unknown) {
  return typeof value === 'string' || typeof value === 'number' ? String(value) : undefined;
}

function nonEmptyString(value: unknown) {
  return typeof value === 'string' && value.trim() ? value : undefined;
}
