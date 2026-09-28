import { useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';

import { AdminApiError, saveFeaturedProducts } from '../../services/adminApi';
import { getProducts } from '../../services/cms';
import type { Product } from '../../types/cms';
import { useUnsavedChanges } from '../unsavedChanges/UnsavedChangesContext';
import { AdminNotice } from './AdminNotice';
import { FormActions } from './FormActions';

export type FeaturedDraftProduct = {
  id: string;
  name: string;
  category: string;
  imageUrl: string;
  active: boolean;
  isFeatured: boolean;
  displayOrder: number;
};

const RESERVED_CATEGORIES = new Set(['test', 'prueba']);

export function isReservedFeaturedCategory(category: string): boolean {
  return RESERVED_CATEGORIES.has(category.trim().toLowerCase());
}

function canBeFeatured(product: FeaturedDraftProduct): boolean {
  return product.active && !isReservedFeaturedCategory(product.category);
}

export function toFeaturedDraft(products: Product[]): FeaturedDraftProduct[] {
  return products
    .filter((product) => !isReservedFeaturedCategory(product.category ?? ''))
    .map((product) => ({
      id: product.id,
      name: product.name,
      category: product.category ?? '',
      imageUrl: product.imageUrl,
      active: product.active,
      isFeatured: product.featured,
      displayOrder: product.sortOrder,
    }));
}

function messageForApiError(error: unknown, fallback: string): string {
  if (error instanceof AdminApiError) return error.message;
  return error instanceof Error ? error.message : fallback;
}

export function productVisibilityLabel(product: Pick<FeaturedDraftProduct, 'active'>): 'Visible' | 'Oculto' {
  return product.active ? 'Visible' : 'Oculto';
}

export function ProductThumbnail({ product, small = false }: { product: FeaturedDraftProduct; small?: boolean }) {
  const size = small ? 'h-14 w-14' : 'h-16 w-16';
  return product.imageUrl ? (
    <img src={product.imageUrl} alt="" className={`${size} shrink-0 rounded-xl object-cover object-center`} />
  ) : (
    <div className={`${size} flex shrink-0 items-center justify-center rounded-xl border border-dashed border-slate-300 bg-slate-50 px-1 text-center text-[10px] leading-3 text-slate-500`}>
      Sin imagen
    </div>
  );
}

type FeaturedProductsEditorProps = { onSaved?: (message: string) => void; onCancel?: () => void };

export function FeaturedProductsEditor({ onSaved, onCancel }: FeaturedProductsEditorProps = {}) {
  const [products, setProducts] = useState<FeaturedDraftProduct[] | null>(null);
  const [initialProducts, setInitialProducts] = useState<FeaturedDraftProduct[] | null>(null);
  const [search, setSearch] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { setDirty } = useUnsavedChanges();

  useEffect(() => {
    let mounted = true;
    async function load() {
      try {
        const loaded = await getProducts();
        if (!mounted) return;
        const draft = toFeaturedDraft(loaded);
        setProducts(draft);
        setInitialProducts(draft);
      } catch {
        if (mounted) setError('No se pudieron cargar los productos.');
      } finally {
        if (mounted) setIsLoading(false);
      }
    }
    void load();
    return () => { mounted = false; };
  }, []);

  const isDirty = useMemo(() => JSON.stringify(products) !== JSON.stringify(initialProducts), [products, initialProducts]);
  useEffect(() => setDirty('featured-products', isDirty), [isDirty, setDirty]);
  useEffect(() => () => setDirty('featured-products', false), [setDirty]);

  const featured = useMemo(
    () => (products ?? []).filter((product) => product.isFeatured).sort((a, b) => a.displayOrder - b.displayOrder),
    [products],
  );
  const notFeatured = useMemo(() => {
    const query = search.trim().toLocaleLowerCase('es');
    return (products ?? []).filter((product) => {
      if (product.isFeatured) return false;
      if (!query) return true;
      return `${product.name} ${product.category}`.toLocaleLowerCase('es').includes(query);
    });
  }, [products, search]);

  const toggleFeatured = (id: string, next: boolean) => {
    setProducts((current) => {
      if (!current) return current;
      if (next) {
        const maxOrder = current.reduce((max, product) => Math.max(max, product.displayOrder), 0);
        return current.map((product) => (product.id === id ? { ...product, isFeatured: true, displayOrder: maxOrder + 1 } : product));
      }
      return current.map((product) => (product.id === id ? { ...product, isFeatured: false } : product));
    });
    setMessage(null);
  };

  const moveFeatured = (id: string, direction: -1 | 1) => {
    setProducts((current) => {
      if (!current) return current;
      const order = [...current].filter((product) => product.isFeatured).sort((a, b) => a.displayOrder - b.displayOrder);
      const index = order.findIndex((product) => product.id === id);
      const target = index + direction;
      if (index < 0 || target < 0 || target >= order.length) return current;
      const swapped = [...order];
      [swapped[index], swapped[target]] = [swapped[target], swapped[index]];
      const orderById = new Map(swapped.map((product, position) => [product.id, position]));
      return current.map((product) => (orderById.has(product.id) ? { ...product, displayOrder: orderById.get(product.id) as number } : product));
    });
    setMessage(null);
  };

  const handleCancel = () => {
    setProducts(initialProducts);
    setMessage(null);
    setError(null);
    setDirty('featured-products', false);
    onCancel?.();
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!products || !initialProducts) return;
    setSaving(true);
    setMessage(null);
    setError(null);
    const initialById = new Map(initialProducts.map((product) => [product.id, product]));
    const changed = products.filter((product) => {
      const before = initialById.get(product.id);
      return !before || before.isFeatured !== product.isFeatured || before.displayOrder !== product.displayOrder;
    });
    try {
      await saveFeaturedProducts(changed.map((product) => ({ id: product.id, isFeatured: product.isFeatured, displayOrder: product.displayOrder })));
      setInitialProducts(products);
      setDirty('featured-products', false);
      const savedMessage = 'Productos destacados actualizados correctamente.';
      setMessage(savedMessage);
      onSaved?.(savedMessage);
    } catch (submitError) {
      setError(messageForApiError(submitError, 'No se pudieron guardar los productos destacados.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      {message ? <AdminNotice>{message}</AdminNotice> : null}
      {error ? <p className="text-sm text-red-600" role="alert">{error}</p> : null}
      {isLoading ? (
        <div aria-busy="true" className="py-4 text-sm text-slate-600">Cargando productos...</div>
      ) : (
        <form className="space-y-6" onSubmit={handleSubmit}>
          <div>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="text-base font-semibold text-slate-900">Productos seleccionados</h3>
              <p className="text-sm font-medium text-slate-600">{featured.length} {featured.length === 1 ? 'producto seleccionado' : 'productos seleccionados'}</p>
            </div>
            {featured.length === 0 ? (
              <p className="mt-3 text-sm text-slate-500">Todavía no elegiste ningún producto destacado.</p>
            ) : (
              <ul className="mt-3 divide-y divide-slate-200 border-y border-slate-200">
                {featured.map((product, index) => (
                  <li key={product.id} className="flex flex-col gap-3 py-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex min-w-0 items-center gap-3">
                      <ProductThumbnail product={product} small />
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-slate-900">{product.name}</p>
                        <p className="mt-0.5 text-xs text-slate-500">{product.category || 'Sin categoría'} · Orden {index + 1}</p>
                        <span className={`mt-1 inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ${product.active ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-600'}`}>
                          {productVisibilityLabel(product)}
                        </span>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2 sm:justify-end">
                      <button type="button" disabled={index === 0} onClick={() => moveFeatured(product.id, -1)} aria-label={`Mover ${product.name} antes`} className="min-h-11 rounded-full border border-slate-300 px-3 text-xs font-medium text-slate-700 transition hover:border-slate-900 disabled:cursor-not-allowed disabled:opacity-40">Mover antes</button>
                      <button type="button" disabled={index === featured.length - 1} onClick={() => moveFeatured(product.id, 1)} aria-label={`Mover ${product.name} después`} className="min-h-11 rounded-full border border-slate-300 px-3 text-xs font-medium text-slate-700 transition hover:border-slate-900 disabled:cursor-not-allowed disabled:opacity-40">Mover después</button>
                      <button type="button" onClick={() => toggleFeatured(product.id, false)} className="min-h-11 rounded-full border border-slate-300 px-3 text-xs font-medium text-slate-700 transition hover:border-slate-900">Quitar</button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="border-t border-slate-200 pt-5">
            <h3 className="text-base font-semibold text-slate-900">Otros productos</h3>
            <label htmlFor="featured-product-search" className="mt-3 block text-sm font-medium text-slate-800">Buscar producto</label>
            <input id="featured-product-search" type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar por nombre o categoría..." className="admin-input mt-2 sm:max-w-sm" />
            {notFeatured.length === 0 ? (
              <p className="mt-4 text-sm text-slate-500">No hay productos para mostrar con esta búsqueda.</p>
            ) : (
              <ul className="mt-3 divide-y divide-slate-200 border-y border-slate-200">
                {notFeatured.map((product) => {
                  const eligible = canBeFeatured(product);
                  return (
                    <li key={product.id} className="flex flex-col gap-3 py-3 sm:flex-row sm:items-center sm:justify-between">
                      <div className="flex min-w-0 items-center gap-3">
                        <ProductThumbnail product={product} small />
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-slate-900">{product.name}</p>
                          <p className="mt-0.5 text-xs text-slate-500">{product.category || 'Sin categoría'}</p>
                          <span className={`mt-1 inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ${product.active ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-600'}`}>{productVisibilityLabel(product)}</span>
                        </div>
                      </div>
                      <div className="sm:text-right">
                        <button type="button" disabled={!eligible} onClick={() => toggleFeatured(product.id, true)} className="min-h-11 rounded-full border border-slate-300 px-4 text-sm font-semibold text-slate-700 transition hover:border-slate-900 disabled:cursor-not-allowed disabled:opacity-50">Agregar</button>
                        {!product.active ? <p className="mt-1 text-xs text-slate-500">Primero mostralo en la tienda.</p> : null}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
          <FormActions onCancel={handleCancel} saving={saving} sticky />
        </form>
      )}
    </div>
  );
}
