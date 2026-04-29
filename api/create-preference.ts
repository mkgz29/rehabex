import { MercadoPagoConfig, Preference } from 'mercadopago';

type ApiRequest = {
  method?: string;
  body?: unknown;
  headers?: Record<string, string | string[] | undefined>;
};

type ApiResponse = {
  status: (statusCode: number) => ApiResponse;
  json: (body: unknown) => void;
  setHeader?: (name: string, value: string) => void;
};

type CheckoutItemInput = {
  id?: unknown;
  name?: unknown;
  title?: unknown;
  quantity?: unknown;
  unit_price?: unknown;
};

type PreferenceItem = {
  id: string;
  title: string;
  quantity: number;
  unit_price: number;
  currency_id: 'ARS';
};

export default async function handler(request: ApiRequest, response: ApiResponse) {
  if (request.method !== 'POST') {
    response.setHeader?.('Allow', 'POST');
    return response.status(405).json({ error: 'Metodo no permitido.' });
  }

  const accessToken = process.env.MERCADOPAGO_ACCESS_TOKEN;
  if (!accessToken) {
    return response.status(500).json({ error: 'Mercado Pago no esta configurado.' });
  }

  const rawItems = getRequestItems(request.body);
  const items = rawItems.map(normalizeItem);

  const invalidItem = items.find((item) => !item);
  if (!rawItems.length || invalidItem) {
    return response.status(400).json({ error: 'El carrito contiene items invalidos.' });
  }

  const preferenceItems = items as PreferenceItem[];
  const origin = getRequestOrigin(request);

  try {
    const client = new MercadoPagoConfig({ accessToken });
    const preference = new Preference(client);

    // TODO: para produccion, revalidar ids y precios contra Supabase antes de crear la preferencia.
    const mercadoPagoResponse = await preference.create({
      body: {
        items: preferenceItems,
        back_urls: {
          success: `${origin}/carrito?status=success`,
          failure: `${origin}/carrito?status=failure`,
          pending: `${origin}/carrito?status=pending`,
        },
        auto_return: 'approved',
        metadata: {
          cart_items: preferenceItems.map((item) => ({
            id: item.id,
            quantity: item.quantity,
            unit_price: item.unit_price,
          })),
        },
      },
    });

    const checkoutUrl = mercadoPagoResponse.init_point ?? mercadoPagoResponse.sandbox_init_point;
    if (!checkoutUrl) {
      return response.status(502).json({ error: 'Mercado Pago no devolvio una URL de checkout.' });
    }

    return response.status(200).json({ checkoutUrl });
  } catch (error) {
    console.error('[checkout] No se pudo crear la preferencia de Mercado Pago.', error);
    return response.status(500).json({ error: 'No se pudo crear la preferencia de pago.' });
  }
}

function getRequestItems(body: unknown) {
  if (!body || typeof body !== 'object') {
    return [] as CheckoutItemInput[];
  }

  const items = (body as { items?: unknown }).items;
  return Array.isArray(items) ? (items as CheckoutItemInput[]) : [];
}

function normalizeItem(item: CheckoutItemInput) {
  const id = typeof item.id === 'string' ? item.id : '';
  const titleValue = typeof item.title === 'string' ? item.title : item.name;
  const title = typeof titleValue === 'string' ? titleValue.trim() : '';
  const quantity = Number(item.quantity);
  const unitPrice = Number(item.unit_price);

  if (!id || !title || !Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(unitPrice) || unitPrice <= 0) {
    return null;
  }

  return {
    id,
    title,
    quantity: Math.floor(quantity),
    unit_price: unitPrice,
    currency_id: 'ARS' as const,
  };
}

function getRequestOrigin(request: ApiRequest) {
  const forwardedHost = getHeaderValue(request.headers?.['x-forwarded-host']);
  const host = forwardedHost ?? getHeaderValue(request.headers?.host) ?? 'localhost:5173';
  const proto = getHeaderValue(request.headers?.['x-forwarded-proto']) ?? (host.startsWith('localhost') ? 'http' : 'https');

  return `${proto}://${host}`;
}

function getHeaderValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}
