// Browser-side client for the ADMIN-01B admin API. Every mutation goes
// through /api/admin/*, carrying the caller's own Supabase access token; the
// panel never writes to products/settings directly anymore.
import { supabase } from '../lib/supabase';
import type { AboutContent, HeroContent, Product, ProductInput } from '../types/cms';

export type AdminApiErrorKind = 'unauthorized' | 'forbidden' | 'not_found' | 'conflict' | 'validation' | 'unavailable';

export class AdminApiError extends Error {
  readonly kind: AdminApiErrorKind;
  readonly status: number;

  constructor(status: number, kind: AdminApiErrorKind, message: string) {
    super(message);
    this.kind = kind;
    this.status = status;
  }
}

function messageForStatus(status: number) {
  switch (status) {
    case 401:
      return 'Tu sesion expiro. Volve a iniciar sesion.';
    case 403:
      return 'No tenes permisos de administrador para esta accion.';
    case 404:
      return 'No se encontro el registro.';
    case 409:
      return 'Este contenido fue modificado en otra sesion. Recarga los datos antes de guardar.';
    case 422:
      return 'Revisa los datos del formulario.';
    default:
      return 'No se pudo completar la operacion. Intenta nuevamente.';
  }
}

function kindForStatus(status: number): AdminApiErrorKind {
  switch (status) {
    case 401:
      return 'unauthorized';
    case 403:
      return 'forbidden';
    case 404:
      return 'not_found';
    case 409:
      return 'conflict';
    case 422:
      return 'validation';
    default:
      return 'unavailable';
  }
}

async function getAccessToken(): Promise<string> {
  if (!supabase) throw new AdminApiError(401, 'unauthorized', 'Supabase no esta configurado.');
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new AdminApiError(401, 'unauthorized', 'Sesion invalida. Volve a iniciar sesion.');
  return token;
}

async function postAdmin<T>(path: string, body: unknown): Promise<T> {
  const token = await getAccessToken();
  let response: Response;
  try {
    response = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
  } catch {
    throw new AdminApiError(0, 'unavailable', 'No se pudo conectar con el servidor.');
  }

  if (!response.ok) {
    throw new AdminApiError(response.status, kindForStatus(response.status), messageForStatus(response.status));
  }

  return (await response.json()) as T;
}

type ProductApiResponse = {
  id: string;
  name: string;
  description: string;
  category?: string;
  price: number;
  imageUrl: string;
  imageAssetId?: string;
  featured: boolean;
  sortOrder: number;
  active: boolean;
  createdAt: string;
  updatedAt: string;
};

function mapProductResponse(product: ProductApiResponse): Product {
  return { ...product };
}

/**
 * A freshly uploaded asset (from *this* edit only) always wins over the
 * existing imageUrl; the two are mutually exclusive server-side. Never pass
 * a product's own already-attached imageAssetId back here: it is no longer
 * `pending` once attached, and resending it would be rejected. Passing
 * `null` (no new upload this edit) keeps the existing image via imageUrl.
 */
function imageFieldsForRequest(imageUrl: string, imageAssetId: string | null) {
  return imageAssetId ? { imageUrl: null, imageAssetId } : { imageUrl: imageUrl || null, imageAssetId: null };
}

export async function createProduct(input: Omit<ProductInput, 'id' | 'active' | 'imageAssetId'>, imageAssetId: string | null = null): Promise<Product> {
  const { product } = await postAdmin<{ product: ProductApiResponse }>('/api/admin/products/create', {
    name: input.name,
    description: input.description,
    category: input.category ?? '',
    price: input.price,
    ...imageFieldsForRequest(input.imageUrl, imageAssetId),
    isFeatured: input.featured,
    displayOrder: input.sortOrder,
  });
  return mapProductResponse(product);
}

export async function updateProduct(
  input: ProductInput & { id: string; expectedUpdatedAt: string },
  imageAssetId: string | null = null,
): Promise<Product> {
  const { product } = await postAdmin<{ product: ProductApiResponse }>('/api/admin/products/update', {
    id: input.id,
    expectedUpdatedAt: input.expectedUpdatedAt,
    name: input.name,
    description: input.description,
    category: input.category ?? '',
    price: input.price,
    ...imageFieldsForRequest(input.imageUrl, imageAssetId),
    isFeatured: input.featured,
    displayOrder: input.sortOrder,
  });
  return mapProductResponse(product);
}

export async function setProductActive(id: string, isActive: boolean, expectedUpdatedAt: string): Promise<Product> {
  const { product } = await postAdmin<{ product: ProductApiResponse }>('/api/admin/products/set-active', {
    id,
    isActive,
    expectedUpdatedAt,
  });
  return mapProductResponse(product);
}

type SettingApiResponse<T> = { value: T; updatedAt: string };

export async function saveHeroContent(
  content: HeroContent,
  expectedUpdatedAt: string | null,
  imageAssetId: string | null = null,
): Promise<{ content: HeroContent; updatedAt: string }> {
  const { setting } = await postAdmin<{ setting: SettingApiResponse<HeroContent> }>('/api/admin/settings/hero', {
    value: content,
    expectedUpdatedAt,
    imageAssetId,
  });
  return { content: setting.value, updatedAt: setting.updatedAt };
}

export async function saveAboutContent(
  content: AboutContent,
  expectedUpdatedAt: string | null,
  imageAssetId: string | null = null,
): Promise<{ content: AboutContent; updatedAt: string }> {
  const { setting } = await postAdmin<{ setting: SettingApiResponse<AboutContent> }>('/api/admin/settings/about', {
    value: content,
    expectedUpdatedAt,
    imageAssetId,
  });
  return { content: setting.value, updatedAt: setting.updatedAt };
}

/** Reads the current version of a CMS document, for the initial expectedUpdatedAt. */
export async function getSettingVersion(key: 'hero_content' | 'about_content'): Promise<string | null> {
  if (!supabase) return null;
  const { data, error } = await supabase.from('settings').select('updated_at').eq('key', key).maybeSingle();
  if (error || !data) return null;
  return data.updated_at ?? null;
}
