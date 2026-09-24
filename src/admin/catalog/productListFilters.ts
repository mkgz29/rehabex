export type VisibilityFilter = 'all' | 'visible' | 'hidden';

export type FilterableProduct = { name: string; category?: string; active: boolean };

export function matchesSearch(product: FilterableProduct, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return product.name.toLowerCase().includes(q);
}

export function matchesVisibility(product: FilterableProduct, filter: VisibilityFilter): boolean {
  if (filter === 'all') return true;
  return filter === 'visible' ? product.active : !product.active;
}

export function matchesCategory(product: FilterableProduct, category: string): boolean {
  if (!category) return true;
  return (product.category ?? '').trim().toLowerCase() === category.trim().toLowerCase();
}

export function filterProducts<T extends FilterableProduct>(
  products: T[],
  filters: { query: string; visibility: VisibilityFilter; category: string },
): T[] {
  return products.filter(
    (product) => matchesSearch(product, filters.query) && matchesVisibility(product, filters.visibility) && matchesCategory(product, filters.category),
  );
}
