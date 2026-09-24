import type { Product } from '../types/cms';

export function isInternalCategory(category?: string) {
  return category ? /^(test|prueba)$/i.test(category.trim()) : false;
}

export function isPublicCatalogProduct(product: Pick<Product, 'active' | 'category'>) {
  return product.active && !isInternalCategory(product.category);
}

export function getCategoryStoreHref(category: string) {
  return `/tienda?categoria=${encodeURIComponent(category)}`;
}
