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

type ProductMarketingValue = {
  category?: string;
  ctaText?: string;
  ctaLink?: string;
  featured?: boolean;
  sortOrder?: number;
};

type ProductMarketingMap = Record<string, ProductMarketingValue>;

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
    category: undefined,
    ctaText: 'Consultar disponibilidad',
    ctaLink: '#contacto',
    featured: false,
    sortOrder: 0,
    active: row.active,
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
    throw new Error('No se pudo cargar la configuracion comercial de productos.');
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

  const [{ data, error }, marketing] = await Promise.all([
    supabase.from('products').select('id, name, description, price, image_url, active').order('created_at', { ascending: true }),
    getProductMarketingContent(),
  ]);

  if (error) {
    throw new Error('No se pudieron cargar los productos.');
  }

  return mergeProductMarketing(((data ?? []) as ProductRow[]).map(mapProductRow), marketing);
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

  const savedProduct = {
    ...mapProductRow(data as ProductRow),
    category: product.category,
    ctaText: product.ctaText,
    ctaLink: product.ctaLink,
    featured: product.featured,
    sortOrder: product.sortOrder,
  };

  const marketing = await getProductMarketingContent();
  marketing[savedProduct.id] = {
    category: savedProduct.category,
    ctaText: savedProduct.ctaText,
    ctaLink: savedProduct.ctaLink,
    featured: savedProduct.featured,
    sortOrder: savedProduct.sortOrder,
  };
  await saveProductMarketingContent(marketing);

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
