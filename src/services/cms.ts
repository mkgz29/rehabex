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
  active: boolean;
};

function cloneLandingContent() {
  return JSON.parse(JSON.stringify(defaultLandingContent)) as LandingContent;
}

function mapProductRow(row: ProductRow): Product {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    price: Number(row.price),
    imageUrl: row.image_url,
    active: row.active,
  };
}

function mergeLandingSettings(settings: SettingRow[]) {
  const merged = cloneLandingContent();

  for (const setting of settings) {
    if (setting.key === 'hero_content' && setting.value) {
      merged.hero = setting.value as HeroContent;
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
    return cloneLandingContent();
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

  const { data, error } = await supabase
    .from('products')
    .select('id, name, description, price, image_url, active')
    .order('created_at', { ascending: true });

  if (error) {
    throw new Error('No se pudieron cargar los productos.');
  }

  return ((data ?? []) as ProductRow[]).map(mapProductRow);
}

export async function saveProduct(product: ProductInput) {
  if (!supabase) {
    return {
      ...product,
      id: product.id ?? crypto.randomUUID(),
    } as Product;
  }

  const payload = {
    id: product.id,
    name: product.name,
    description: product.description,
    price: product.price,
    image_url: product.imageUrl,
    active: product.active,
  };

  const query = product.id
    ? supabase
        .from('products')
        .update(payload)
        .eq('id', product.id)
        .select('id, name, description, price, image_url, active')
        .single()
    : supabase
        .from('products')
        .insert(payload)
        .select('id, name, description, price, image_url, active')
        .single();

  const { data, error } = await query;

  if (error || !data) {
    throw new Error('No se pudo guardar el producto.');
  }

  return mapProductRow(data as ProductRow);
}

export async function deleteProduct(productId: string) {
  if (!supabase) {
    return;
  }

  const { error } = await supabase.from('products').delete().eq('id', productId);

  if (error) {
    throw new Error('No se pudo eliminar el producto.');
  }
}
