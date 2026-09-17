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
  | { kind: 'not_found'; httpStatus?: 404 }
  | { kind: 'unavailable'; httpStatus?: number };

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
  try {
    const paymentResponse = await fetchPayment(`https://api.mercadopago.com/v1/payments/${encodeURIComponent(paymentId)}`, requestOptions(accessToken));
    if (paymentResponse.status === 404) return { kind: 'not_found', httpStatus: 404 };
    if (!paymentResponse.ok) return { kind: 'unavailable', httpStatus: paymentResponse.status };

    const payment = asPaymentResponse(await paymentResponse.json());
    let preferenceId = nonEmptyString(payment.preference_id);
    if (!preferenceId) {
      const merchantOrderId = merchantOrderIdFor(payment);
      if (!merchantOrderId) return { kind: 'ok', payment: adaptMercadoPagoPayment(payment, undefined) };

      const merchantOrderResponse = await fetchPayment(`https://api.mercadopago.com/merchant_orders/${encodeURIComponent(merchantOrderId)}`, requestOptions(accessToken));
      if (!merchantOrderResponse.ok) return { kind: 'unavailable', httpStatus: merchantOrderResponse.status };
      preferenceId = nonEmptyString(asMerchantOrderResponse(await merchantOrderResponse.json()).preference_id);
    }

    return { kind: 'ok', payment: adaptMercadoPagoPayment(payment, preferenceId) };
  } catch {
    return { kind: 'unavailable' };
  }
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

function merchantOrderIdFor(payment: MercadoPagoPaymentResponse) {
  return payment.order && typeof payment.order === 'object' ? identifier(payment.order.id) : undefined;
}

function identifier(value: unknown) {
  return typeof value === 'string' || typeof value === 'number' ? String(value) : undefined;
}

function nonEmptyString(value: unknown) {
  return typeof value === 'string' && value.trim() ? value : undefined;
}
