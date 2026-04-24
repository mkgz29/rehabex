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
  description: string;
  price: number;
  image_url: string;
  is_active: boolean;
  is_featured?: boolean | null;
  display_order?: number | null;
  category?: string | null;
};

type ProductMarketingValue = {
  category?: string;
  ctaText?: string;
  ctaLink?: string;
  featured?: boolean;
  sortOrder?: number;
};

type ProductMarketingMap = Record<string, ProductMarketingValue>;

const LOCAL_SETTINGS_KEY = 'rehabex.settings';

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
    description: row.description,
    price: Number(row.price),
    imageUrl: row.image_url,
    category: row.category ?? undefined,
    ctaText: 'Consultar disponibilidad',
    ctaLink: '#contacto',
    featured: Boolean(row.is_featured),
    sortOrder: Number(row.display_order ?? 0),
    active: row.is_active,
  };
}

function mergeProductMarketing(products: Product[], marketing: ProductMarketingMap) {
  return products.map((product) => {
    const marketingValue = marketing[product.id];

    return {
      ...product,
      category: marketingValue?.category ?? product.category,
      ctaText: marketingValue?.ctaText ?? product.ctaText,
      ctaLink: marketingValue?.ctaLink ?? product.ctaLink,
      featured: marketingValue?.featured ?? product.featured,
      sortOrder: marketingValue?.sortOrder ?? product.sortOrder,
    };
  });
}

async function getProductMarketingContent() {
  if (!supabase) {
    return {} as ProductMarketingMap;
  }

  const { data, error } = await supabase
    .from('settings')
    .select('value')
    .eq('key', 'product_marketing_content')
    .maybeSingle();

  if (error) {
    console.error('[cms] No se pudo cargar product_marketing_content', error);
    throw new Error(formatSupabaseError('No se pudo cargar la configuracion comercial de productos', error));
  }

  return ((data?.value as ProductMarketingMap | null) ?? {}) as ProductMarketingMap;
}

async function saveProductMarketingContent(marketing: ProductMarketingMap) {
  return saveSetting('product_marketing_content', marketing);
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

    if (setting.key === 'featured_product_ids' && Array.isArray(setting.value)) {
      merged.featuredProductIds = setting.value as string[];
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

export async function saveFeaturedProductIds(productIds: string[]) {
  return saveSetting('featured_product_ids', productIds);
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
    console.log('Cargando productos desde datos mock: cliente Supabase no configurado.');
    return [...defaultProducts];
  }

  console.log('Cargando productos desde Supabase...');
  const { data, error } = await supabase.from('products').select('*').order('display_order', { ascending: true });
  console.log('products data:', data);
  console.log('products error:', error);

  if (error) {
    console.error('[cms] No se pudieron cargar los productos', error);
    throw new Error(formatSupabaseError('No se pudieron cargar los productos', error));
  }

  let marketing: ProductMarketingMap = {};
  try {
    marketing = await getProductMarketingContent();
  } catch {
    marketing = {};
  }

  console.log('products mapped:', ((data ?? []) as ProductRow[]).map(mapProductRow));
  return mergeProductMarketing(((data ?? []) as ProductRow[]).map(mapProductRow), marketing);
}

export async function saveProduct(product: ProductInput) {
  if (!supabase) {
    return {
      ...product,
      id: product.id ?? crypto.randomUUID(),
    } as Product;
  }

  const normalizedPrice = Number(product.price);
  if (!Number.isFinite(normalizedPrice) || normalizedPrice < 0) {
    throw new Error('El precio del producto no es valido.');
  }

  const payload = {
    ...(product.id ? { id: product.id } : {}),
    name: product.name.trim(),
    description: product.description.trim(),
    category: product.category?.trim() || null,
    price: normalizedPrice,
    image_url: product.imageUrl.trim(),
    is_featured: product.featured,
    display_order: product.sortOrder,
    is_active: product.active,
  };

  const query = product.id
    ? supabase
        .from('products')
        .update(payload)
        .eq('id', product.id)
        .select('id, name, description, price, image_url, category, is_featured, display_order, is_active')
        .single()
    : supabase
        .from('products')
        .insert(payload)
        .select('id, name, description, price, image_url, category, is_featured, display_order, is_active')
        .single();

  const { data, error } = await query;

  if (error || !data) {
    throw new Error(
      formatSupabaseError(
        `No se pudo guardar el producto en Supabase${product.id ? ` (id=${product.id})` : ''}`,
        error ?? { message: 'La operacion no devolvio datos.' },
      ),
    );
  }

  const savedProduct = {
    ...mapProductRow(data as ProductRow),
    ctaText: product.ctaText,
    ctaLink: product.ctaLink,
  };

  const marketing = await getProductMarketingContent();
  marketing[savedProduct.id] = {
    category: savedProduct.category,
    ctaText: savedProduct.ctaText,
    ctaLink: savedProduct.ctaLink,
    featured: savedProduct.featured,
    sortOrder: savedProduct.sortOrder,
  };
  try {
    await saveProductMarketingContent(marketing);
  } catch (error) {
    if (error instanceof Error) {
      console.error('[cms] No se pudo guardar el marketing del producto', error);
      throw error;
    }

    console.error('[cms] No se pudo guardar el marketing del producto', error);
    throw new Error('No se pudo guardar la configuracion comercial del producto.');
  }

  return savedProduct;
}

export async function deleteProduct(productId: string) {
  if (!supabase) {
    return;
  }

  const { error } = await supabase.from('products').delete().eq('id', productId);

  if (error) {
    throw new Error('No se pudo eliminar el producto.');
  }

  const marketing = await getProductMarketingContent();
  if (productId in marketing) {
    delete marketing[productId];
    await saveProductMarketingContent(marketing);
  }
}
