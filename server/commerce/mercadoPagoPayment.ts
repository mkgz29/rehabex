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

type FetchResponse = { ok: boolean; status: number; json: () => Promise<unknown> };
type FetchPayment = (input: string, init: { headers: Record<string, string> }) => Promise<FetchResponse>;

export type MercadoPagoProviderResult =
  | { kind: 'ok'; payment: MercadoPagoPayment }
  | MercadoPagoProviderFailure;

export type MercadoPagoProviderStage = 'payment_fetch' | 'payment_parse' | 'merchant_order_fetch' | 'merchant_order_parse';

export type MercadoPagoProviderFailure = {
  kind: 'not_found' | 'unavailable';
  stage: MercadoPagoProviderStage;
  errorCode: string;
  httpStatus?: number;
};

/**
 * Keeps the provider payload at the boundary and passes the payment processor
 * one canonical DTO only. Checkout Pro Payment does not guarantee a
 * preference_id, so it is read from the documented merchant order when needed.
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
  if (!preferenceId) {
    const merchantOrderId = merchantOrderIdFor(payment);
    if (!merchantOrderId) return providerUnavailable('payment_parse', 'provider_payment_preference_missing', paymentResponse.status);

    let merchantOrderResponse: FetchResponse;
    try {
      merchantOrderResponse = await fetchPayment(`https://api.mercadopago.com/merchant_orders/${encodeURIComponent(merchantOrderId)}`, requestOptions(accessToken));
    } catch {
      return providerUnavailable('merchant_order_fetch', 'provider_merchant_order_network_error');
    }
    if (!merchantOrderResponse.ok) return providerUnavailable('merchant_order_fetch', 'provider_merchant_order_http_error', merchantOrderResponse.status);
    try {
      preferenceId = requiredMerchantOrderPreference(await merchantOrderResponse.json());
    } catch {
      return providerUnavailable('merchant_order_parse', 'provider_merchant_order_parse_error', merchantOrderResponse.status);
    }
  }

  return { kind: 'ok', payment: adaptMercadoPagoPayment(payment, preferenceId) };
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

function requestOptions(accessToken: string) {
  return { headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' } };
}

function asPaymentResponse(value: unknown): MercadoPagoPaymentResponse {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as MercadoPagoPaymentResponse : {};
}

function asMerchantOrderResponse(value: unknown): MercadoPagoMerchantOrderResponse {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as MercadoPagoMerchantOrderResponse : {};
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

function requiredMerchantOrderPreference(value: unknown) {
  const preferenceId = nonEmptyString(asMerchantOrderResponse(value).preference_id);
  if (!preferenceId) throw new Error('invalid provider merchant order response');
  return preferenceId;
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
