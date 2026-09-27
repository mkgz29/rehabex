import { defaultLandingContent } from '../lib/defaultContent';
import { isPublicCatalogProduct } from '../lib/catalog';
import { supabase } from '../lib/supabase';
import type { AboutContent, HeroContent, LandingContent, Product, ProductImage } from '../types/cms';

type SettingRow = {
  key: string;
  value: unknown;
};

type ProductRow = {
  id: string;
  name: string;
  description: string | null;
  price: number;
  image_url: string | null;
  is_active: boolean;
  is_featured: boolean;
  display_order: number;
  category?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  stock_on_hand?: number | null;
};

type ProductImageRow = { product_id: string; media_asset_id: string | null; url: string; is_primary: boolean; display_order: number };

const LOCAL_SETTINGS_KEY = 'rehabex.settings';
const PRODUCT_SELECT = 'id, name, description, category, price, image_url, is_featured, display_order, is_active, created_at, updated_at, stock_on_hand';
const GALLERY_SELECT = 'product_id, media_asset_id, url, is_primary, display_order';

function mapGalleryRow(row: ProductImageRow): ProductImage {
  return { mediaAssetId: row.media_asset_id, url: row.url, isPrimary: row.is_primary, displayOrder: row.display_order };
}

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

export function normalizeHeroContent(value: unknown): HeroContent | null {
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
    // Never falls back to a stock photo: a missing/blank/invalid persisted
    // image resolves to '' (the explicit "no image configured" state), not
    // an editorial placeholder. Independent of whatever defaultContent.ts
    // holds, so this invariant can't regress if a textual default changes.
    image_url:
      typeof raw.image_url === 'string' && raw.image_url.trim() !== ''
        ? raw.image_url
        : typeof raw.imageUrl === 'string' && raw.imageUrl.trim() !== ''
          ? raw.imageUrl
          : '',
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

function formatSupabaseError(context: string) {
  return `${context}.`;
}

function mapProductRow(row: ProductRow): Product {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? '',
    price: Number(row.price),
    imageUrl: row.image_url ?? '',
    category: row.category ?? undefined,
    featured: Boolean(row.is_featured),
    sortOrder: Number(row.display_order ?? 0),
    active: row.is_active,
    createdAt: row.created_at ?? undefined,
    updatedAt: row.updated_at ?? undefined,
    stockOnHand: row.stock_on_hand === null || row.stock_on_hand === undefined ? undefined : Number(row.stock_on_hand),
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

export async function getProducts() {
  if (!supabase) {
    throw new Error('Supabase no esta configurado para cargar el catalogo administrativo.');
  }

  const { data, error } = await supabase.from('products').select(PRODUCT_SELECT).order('display_order', { ascending: true });

  if (error) {
    throw new Error(formatSupabaseError('No se pudieron cargar los productos'));
  }

  const products = ((data ?? []) as ProductRow[]).map(mapProductRow);
  if (products.length === 0) return products;

  const { data: galleryRows, error: galleryError } = await supabase
    .from('product_images')
    .select(GALLERY_SELECT)
    .in('product_id', products.map((product) => product.id))
    .order('display_order', { ascending: true });

  if (galleryError) {
    throw new Error(formatSupabaseError('No se pudieron cargar las imagenes de los productos'));
  }

  const galleryByProductId = new Map<string, ProductImage[]>();
  for (const row of (galleryRows ?? []) as ProductImageRow[]) {
    const list = galleryByProductId.get(row.product_id) ?? [];
    list.push(mapGalleryRow(row));
    galleryByProductId.set(row.product_id, list);
  }

  return products.map((product) => ({ ...product, gallery: galleryByProductId.get(product.id) ?? [] }));
}

export async function getActiveProducts() {
  if (!supabase) {
    throw new Error('Supabase no esta configurado para cargar el catalogo.');
  }

  const { data, error } = await supabase
    .from('products')
    .select(PRODUCT_SELECT)
    .eq('is_active', true)
    .order('display_order', { ascending: true })
    .order('created_at', { ascending: false });

  if (error) {
    throw new Error(formatSupabaseError('No se pudieron cargar los productos activos'));
  }

  return ((data ?? []) as ProductRow[]).map(mapProductRow).filter(isPublicCatalogProduct);
}

export async function getProductById(productId: string) {
  if (!supabase) {
    throw new Error('Supabase no esta configurado para cargar el producto.');
  }

  const { data, error } = await supabase
    .from('products')
    .select(PRODUCT_SELECT)
    .eq('id', productId)
    .eq('is_active', true)
    .maybeSingle();

  if (error) {
    throw new Error(formatSupabaseError('No se pudo cargar el producto'));
  }

  if (!data) {
    return null;
  }

  const product = mapProductRow(data as ProductRow);
  if (!isPublicCatalogProduct(product)) return null;

  const { data: galleryRows, error: galleryError } = await supabase
    .from('product_images')
    .select(GALLERY_SELECT)
    .eq('product_id', productId)
    .order('display_order', { ascending: true });

  if (galleryError) {
    throw new Error(formatSupabaseError('No se pudieron cargar las imagenes del producto'));
  }

  return { ...product, gallery: ((galleryRows ?? []) as ProductImageRow[]).map(mapGalleryRow) };
}
