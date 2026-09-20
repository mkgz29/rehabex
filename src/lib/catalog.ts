export function isInternalCategory(category?: string) {
  return category ? /^(test|prueba)$/i.test(category.trim()) : false;
}

export function getCategoryStoreHref(category: string) {
  return `/tienda?categoria=${encodeURIComponent(category)}`;
}
