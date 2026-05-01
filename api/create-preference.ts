import { MercadoPagoConfig, Preference } from 'mercadopago';
import { createClient } from '@supabase/supabase-js';
import type { SupabaseClient } from '@supabase/supabase-js';

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
  productId?: unknown;
  quantity?: unknown;
};

type PreferenceItem = {
  id: string;
  title: string;
  quantity: number;
  unit_price: number;
  currency_id: 'ARS';
};

type ProductRow = {
  id: string;
  name: string;
  price: number | string;
  is_active: boolean;
};

type ValidCheckoutItem = {
  productId: string;
  quantity: number;
};

export default async function handler(request: ApiRequest, response: ApiResponse) {
  if (request.method !== 'POST') {
    response.setHeader?.('Allow', 'POST');
    return response.status(405).json({ error: 'Metodo no permitido.' });
  }

  const accessToken = process.env.MERCADOPAGO_ACCESS_TOKEN;
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const baseUrl = getBaseUrl();

  if (!accessToken || !supabaseUrl || !supabaseServiceRoleKey) {
    console.error('[checkout] Faltan variables backend requeridas para crear la preferencia.', {
      hasMercadoPagoAccessToken: Boolean(accessToken),
      hasSupabaseUrl: Boolean(supabaseUrl),
      hasSupabaseServiceRoleKey: Boolean(supabaseServiceRoleKey),
    });
    return response.status(500).json({ error: 'El checkout no esta configurado.' });
  }

  const validation = getValidatedItems(request.body);
  if (validation.ok === false) {
    return response.status(400).json({ error: validation.error });
  }

  const items = validation.items;

  try {
    const supabase = createClient(supabaseUrl, supabaseServiceRoleKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });

    const products = await getProductsById(supabase, items.map((item) => item.productId));
    const preferenceItems = buildPreferenceItems(items, products);
    const client = new MercadoPagoConfig({ accessToken });
    const preference = new Preference(client);

    const mercadoPagoResponse = await preference.create({
      body: {
        items: preferenceItems,
        back_urls: {
          success: `${baseUrl}/success`,
          failure: `${baseUrl}/failure`,
          pending: `${baseUrl}/pending`,
        },
        auto_return: 'approved',
        metadata: {
          cart_items: preferenceItems.map((item) => ({
            product_id: item.id,
            quantity: item.quantity,
            unit_price: item.unit_price,
          })),
        },
      },
    });

    console.log('[checkout] Preferencia Mercado Pago creada.', {
      preferenceId: mercadoPagoResponse.id,
      hasSandboxInitPoint: Boolean(mercadoPagoResponse.sandbox_init_point),
      hasInitPoint: Boolean(mercadoPagoResponse.init_point),
    });

    const checkoutUrl = mercadoPagoResponse.sandbox_init_point ?? mercadoPagoResponse.init_point;
    if (!checkoutUrl) {
      console.error('[checkout] Mercado Pago no devolvio init_point ni sandbox_init_point.', mercadoPagoResponse);
      return response.status(502).json({ error: 'Mercado Pago no devolvio una URL de checkout.' });
    }

    return response.status(200).json({ checkoutUrl });
  } catch (error) {
    if (error instanceof CheckoutValidationError) {
      return response.status(400).json({ error: error.message });
    }

    console.error('[checkout] No se pudo crear la preferencia de Mercado Pago.', error);
    return response.status(500).json({ error: 'No se pudo crear la preferencia de pago.' });
  }
}

function getValidatedItems(body: unknown): { ok: true; items: ValidCheckoutItem[] } | { ok: false; error: string } {
  const parsedBody = parseRequestBody(body);

  if (!parsedBody || typeof parsedBody !== 'object') {
    return { ok: false, error: 'El carrito contiene items invalidos.' };
  }

  const items = (parsedBody as { items?: unknown }).items;
  if (!Array.isArray(items) || items.length === 0) {
    return { ok: false, error: 'El carrito contiene items invalidos.' };
  }

  const validatedItems: ValidCheckoutItem[] = [];

  for (const item of items as CheckoutItemInput[]) {
    const productId = typeof item.productId === 'string' ? item.productId.trim() : '';
    const quantity = item.quantity;

    if (!productId) {
      return { ok: false, error: 'El carrito contiene productos invalidos.' };
    }

    if (typeof quantity !== 'number' || !Number.isInteger(quantity) || quantity <= 0) {
      return { ok: false, error: 'El carrito contiene cantidades invalidas.' };
    }

    validatedItems.push({ productId, quantity });
  }

  return { ok: true, items: validatedItems };
}

async function getProductsById(
  supabase: SupabaseClient,
  productIds: string[],
) {
  const uniqueProductIds = [...new Set(productIds)];
  const { data, error } = await supabase
    .from('products')
    .select('id, name, price, is_active')
    .in('id', uniqueProductIds);

  if (error) {
    console.error('[checkout] No se pudieron consultar productos en Supabase.', error);
    throw new Error('No se pudieron validar los productos del carrito.');
  }

  return new Map(((data ?? []) as ProductRow[]).map((product) => [product.id, product]));
}

function buildPreferenceItems(items: ValidCheckoutItem[], products: Map<string, ProductRow>) {
  return items.map((item) => {
    const product = products.get(item.productId);
    if (!product) {
      throw new CheckoutValidationError('El carrito contiene un producto inexistente.');
    }

    if (product.is_active !== true) {
      throw new CheckoutValidationError('El carrito contiene un producto inactivo.');
    }

    const price = Number(product.price);
    if (!Number.isFinite(price) || price <= 0) {
      throw new CheckoutValidationError('El carrito contiene un producto sin precio valido.');
    }

    // TODO: mantener esta validacion server-side y extenderla cuando existan stock, ordenes y webhooks.
    return {
      id: product.id,
      title: product.name,
      quantity: item.quantity,
      unit_price: price,
      currency_id: 'ARS' as const,
    };
  });
}

function getBaseUrl() {
  const publicSiteUrl = process.env.PUBLIC_SITE_URL?.trim() || 'http://localhost:3000';
  return publicSiteUrl.replace(/\/+$/, '');
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

class CheckoutValidationError extends Error {}
