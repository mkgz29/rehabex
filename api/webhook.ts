import { createClient } from '@supabase/supabase-js';

type ApiRequest = {
  method?: string;
  body?: unknown;
};

type ApiResponse = {
  status: (statusCode: number) => ApiResponse;
  json: (body: unknown) => void;
  setHeader?: (name: string, value: string) => void;
};

type MercadoPagoWebhookBody = {
  type?: unknown;
  data?: {
    id?: unknown;
  };
};

type MercadoPagoPayment = {
  id?: number | string;
  status?: string;
  transaction_amount?: number;
  currency_id?: string;
  payer?: {
    email?: string;
  };
  payment_method_id?: string;
  payment_type_id?: string;
  external_reference?: string;
};

export default async function handler(request: ApiRequest, response: ApiResponse) {
  if (request.method !== 'POST') {
    response.setHeader?.('Allow', 'POST');
    return response.status(200).json({ received: true });
  }

  try {
    const body = parseRequestBody(request.body) as MercadoPagoWebhookBody | null;
    const type = typeof body?.type === 'string' ? body.type : null;
    const paymentId = getPaymentId(body);

    console.log('[webhook] Mercado Pago webhook recibido.', {
      type,
      paymentId,
    });

    if (type !== 'payment') {
      console.log('[webhook] Evento ignorado porque no es payment.', { type });
      return response.status(200).json({ received: true });
    }

    if (!paymentId) {
      console.warn('[webhook] Evento payment sin data.id.');
      return response.status(200).json({ received: true });
    }

    const accessToken = process.env.MERCADOPAGO_ACCESS_TOKEN;
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!accessToken || !supabaseUrl || !supabaseServiceRoleKey) {
      console.error('[webhook] Faltan variables backend requeridas.', {
        hasMercadoPagoAccessToken: Boolean(accessToken),
        hasSupabaseUrl: Boolean(supabaseUrl),
        hasSupabaseServiceRoleKey: Boolean(supabaseServiceRoleKey),
      });
      return response.status(200).json({ received: true });
    }

    const payment = await fetchMercadoPagoPayment(paymentId, accessToken);
    if (!payment) {
      return response.status(200).json({ received: true });
    }

    const order = {
      payment_id: String(payment.id ?? paymentId),
      status: payment.status ?? null,
      amount: payment.transaction_amount ?? null,
      currency: payment.currency_id ?? null,
      payer_email: payment.payer?.email ?? null,
      payment_method_id: payment.payment_method_id ?? null,
      payment_type_id: payment.payment_type_id ?? null,
      external_reference: payment.external_reference ?? null,
    };

    const supabase = createClient(supabaseUrl, supabaseServiceRoleKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });

    const { error } = await supabase
      .from('orders')
      .upsert(order, { onConflict: 'payment_id' });

    if (error) {
      console.error('[webhook] No se pudo guardar la orden en Supabase.', {
        paymentId: order.payment_id,
        status: order.status,
        error,
      });
      return response.status(200).json({ received: true });
    }

    console.log('[webhook] Orden sincronizada desde Mercado Pago.', {
      paymentId: order.payment_id,
      status: order.status,
      amount: order.amount,
      currency: order.currency,
    });

    return response.status(200).json({ received: true });
  } catch (error) {
    console.error('[webhook] Error procesando webhook de Mercado Pago.', error);
    return response.status(200).json({ received: true });
  }
}

async function fetchMercadoPagoPayment(paymentId: string, accessToken: string) {
  const url = `https://api.mercadopago.com/v1/payments/${encodeURIComponent(paymentId)}`;
  const mercadoPagoResponse = await fetch(url, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
    },
  });

  if (!mercadoPagoResponse.ok) {
    const errorBody = await mercadoPagoResponse.text();
    console.error('[webhook] Mercado Pago no devolvio el pago.', {
      paymentId,
      status: mercadoPagoResponse.status,
      body: errorBody,
    });
    return null;
  }

  const payment = (await mercadoPagoResponse.json()) as MercadoPagoPayment;
  console.log('[webhook] Pago obtenido desde Mercado Pago.', {
    paymentId: payment.id,
    status: payment.status,
    externalReference: payment.external_reference,
  });

  return payment;
}

function getPaymentId(body: MercadoPagoWebhookBody | null) {
  const value = body?.data?.id;

  if (typeof value === 'string') {
    return value.trim() || null;
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }

  return null;
}

function parseRequestBody(body: unknown) {
  if (typeof body !== 'string') {
    return body;
  }

  try {
    return JSON.parse(body) as unknown;
  } catch {
    return null;
  }
}
