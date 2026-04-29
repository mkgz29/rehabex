import { defaultLandingContent, defaultProducts } from '../lib/defaultContent';
import { supabase } from '../lib/supabase';
import type { AboutContent, HeroContent, LandingContent, Product, ProductInput } from '../types/cms';

type SettingRow = {
  key: string;
  value: unknown;
};

type ProductRow = {
  id: string;
  name: string;
  description: string | null;
  price: number;
  image_url: string;
  is_active: boolean;
  is_featured: boolean;
  display_order: number;
  category?: string | null;
  created_at?: string | null;
};

const LOCAL_SETTINGS_KEY = 'rehabex.settings';
const PRODUCT_SELECT = 'id, name, description, category, price, image_url, is_featured, display_order, is_active, created_at';

function cloneLandingContent() {
  return JSON.parse(JSON.stringify(defaultLandingContent)) as LandingContent;
}

function isBrowser() {
  return typeof window !== 'undefined';
}

function getLocalSettings() {
  if (!isBrowser()) {
    return [] as SettingRow[];
  }

  const raw = window.localStorage.getItem(LOCAL_SETTINGS_KEY);
  if (!raw) {
    return [] as SettingRow[];
  }

  try {
    const parsed = JSON.parse(raw) as SettingRow[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveLocalSettings(settings: SettingRow[]) {
  if (!isBrowser()) {
    return;
  }

  window.localStorage.setItem(LOCAL_SETTINGS_KEY, JSON.stringify(settings));
}

function normalizeHeroContent(value: unknown): HeroContent | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const raw = value as Record<string, unknown>;

  return {
    ...defaultLandingContent.hero,
    title: typeof raw.title === 'string' ? raw.title : defaultLandingContent.hero.title,
    subtitle:
      typeof raw.subtitle === 'string'
        ? raw.subtitle
        : typeof raw.subtitulo === 'string'
          ? raw.subtitulo
          : defaultLandingContent.hero.subtitle,
    image_url:
      typeof raw.image_url === 'string'
        ? raw.image_url
        : typeof raw.imageUrl === 'string'
          ? raw.imageUrl
          : defaultLandingContent.hero.image_url,
    primary_cta_text:
      typeof raw.primary_cta_text === 'string'
        ? raw.primary_cta_text
        : typeof raw.cta_text === 'string'
          ? raw.cta_text
          : typeof raw.ctaText === 'string'
            ? raw.ctaText
            : defaultLandingContent.hero.primary_cta_text,
    primary_cta_link:
      typeof raw.primary_cta_link === 'string'
        ? raw.primary_cta_link
        : typeof raw.cta_link === 'string'
          ? raw.cta_link
          : typeof raw.ctaLink === 'string'
            ? raw.ctaLink
            : defaultLandingContent.hero.primary_cta_link,
  };
}

function formatSupabaseError(context: string, error: { message?: string; details?: string; hint?: string; code?: string }) {
  const parts = [error.message, error.details, error.hint, error.code ? `code=${error.code}` : null].filter(Boolean);
  const message = parts.join(' | ') || 'Error desconocido de Supabase.';
  console.error(`[cms] ${context}`, error);
  return `${context}: ${message}`;
}

function mapProductRow(row: ProductRow): Product {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? '',
    price: Number(row.price),
    imageUrl: row.image_url,
    category: row.category ?? undefined,
    featured: Boolean(row.is_featured),
    sortOrder: Number(row.display_order ?? 0),
    active: row.is_active,
    createdAt: row.created_at ?? undefined,
  };
}

function mergeLandingSettings(settings: SettingRow[]) {
  const merged = cloneLandingContent();

  for (const setting of settings) {
    if (setting.key === 'hero_content' && setting.value) {
      merged.hero = normalizeHeroContent(setting.value) ?? merged.hero;
    }

    if (setting.key === 'about_content' && setting.value) {
      merged.about = setting.value as AboutContent;
    }
  }

  return merged;
}

export async function getLandingContent() {
  if (!supabase) {
    return mergeLandingSettings(getLocalSettings());
  }

  const { data, error } = await supabase.from('settings').select('key, value');

  if (error) {
    throw new Error('No se pudieron cargar las configuraciones de la landing.');
  }

  return mergeLandingSettings((data ?? []) as SettingRow[]);
}

export async function saveHeroContent(hero: HeroContent) {
  return saveSetting('hero_content', hero);
}

export async function saveAboutContent(about: AboutContent) {
  return saveSetting('about_content', about);
}

async function saveSetting(key: string, value: unknown) {
  if (!supabase) {
    const settings = getLocalSettings();
    const nextSettings = settings.filter((setting) => setting.key !== key);
    nextSettings.push({ key, value });
    saveLocalSettings(nextSettings);
    return;
  }

  const { error } = await supabase.from('settings').upsert({ key, value }, { onConflict: 'key' });

  if (error) {
    throw new Error('No se pudo guardar la configuracion.');
  }
}

export async function getProducts() {
  if (!supabase) {
    return [...defaultProducts];
  }

  const { data, error } = await supabase.from('products').select(PRODUCT_SELECT).order('display_order', { ascending: true });

  if (error) {
    throw new Error(formatSupabaseError('No se pudieron cargar los productos', error));
  }

  return ((data ?? []) as ProductRow[]).map(mapProductRow);
}

export async function getActiveProducts() {
  if (!supabase) {
    return [...defaultProducts]
      .filter((product) => product.active)
      .sort((a, b) => a.sortOrder - b.sortOrder || (b.createdAt ?? '').localeCompare(a.createdAt ?? ''));
  }

  const { data, error } = await supabase
    .from('products')
    .select(PRODUCT_SELECT)
    .eq('is_active', true)
    .order('display_order', { ascending: true })
    .order('created_at', { ascending: false });

  if (error) {
    throw new Error(formatSupabaseError('No se pudieron cargar los productos activos', error));
  }

  return ((data ?? []) as ProductRow[]).map(mapProductRow);
}

export async function getProductById(productId: string) {
  if (!supabase) {
    return defaultProducts.find((product) => product.id === productId) ?? null;
  }

  const { data, error } = await supabase.from('products').select(PRODUCT_SELECT).eq('id', productId).maybeSingle();

  if (error) {
    throw new Error(formatSupabaseError('No se pudo cargar el producto', error));
  }

  return data ? mapProductRow(data as ProductRow) : null;
}

export async function saveProduct(product: ProductInput) {
  const payload = mapProductInputToRow(product);

  if (!supabase) {
    return {
      ...product,
      id: product.id ?? crypto.randomUUID(),
      description: payload.description,
      category: payload.category ?? undefined,
      price: payload.price,
      imageUrl: payload.image_url,
      featured: payload.is_featured,
      sortOrder: payload.display_order,
      active: payload.is_active,
    } as Product;
  }

  validateProductInput(product);

  const query = product.id
    ? supabase.from('products').update(payload).eq('id', product.id).select(PRODUCT_SELECT).single()
    : supabase.from('products').insert(payload).select(PRODUCT_SELECT).single();

  const { data, error } = await query;

  if (error || !data) {
    throw new Error(
      formatSupabaseError(
        `No se pudo guardar el producto en Supabase${product.id ? ` (id=${product.id})` : ''}`,
        error ?? { message: 'La operacion no devolvio datos.' },
      ),
    );
  }

  return mapProductRow(data as ProductRow);
}

function validateProductInput(product: ProductInput) {
  if (!product.name.trim()) {
    throw new Error('El nombre del producto es obligatorio.');
  }

  const normalizedPrice = Number(product.price);
  if (!Number.isFinite(normalizedPrice) || normalizedPrice <= 0) {
    throw new Error('El precio del producto debe ser mayor a 0.');
  }

  if (!product.imageUrl.trim()) {
    throw new Error('La imagen del producto es obligatoria.');
  }
}

function mapProductInputToRow(product: ProductInput) {
  validateProductInput(product);

  return {
    ...(product.id ? { id: product.id } : {}),
    name: product.name.trim(),
    description: product.description.trim(),
    category: product.category?.trim() || null,
    price: Number(product.price),
    image_url: product.imageUrl.trim(),
    is_featured: product.featured,
    display_order: Number(product.sortOrder) || 0,
    is_active: product.active,
  };
}

export async function deleteProduct(productId: string) {
  if (!supabase) {
    return;
  }

  const { error } = await supabase.from('products').delete().eq('id', productId);

  if (error) {
    throw new Error(formatSupabaseError('No se pudo eliminar el producto de Supabase', error));
  }
}
