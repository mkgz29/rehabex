import { useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';

import { getProducts } from '../../services/cms';
import { AdminApiError, saveFeaturedProducts } from '../../services/adminApi';
import type { Product } from '../../types/cms';
import { AdminNotice } from './AdminNotice';
import { FormActions } from './FormActions';
import { useUnsavedChanges } from '../unsavedChanges/UnsavedChangesContext';

type DraftProduct = { id: string; name: string; category: string; active: boolean; isFeatured: boolean; displayOrder: number };

const RESERVED_CATEGORIES = new Set(['test', 'prueba']);

function isReservedCategory(category: string): boolean {
  return RESERVED_CATEGORIES.has(category.trim().toLowerCase());
}

function canBeFeatured(product: DraftProduct): boolean {
  return product.active && !isReservedCategory(product.category);
}

function toDraft(products: Product[]): DraftProduct[] {
  return products.map((product) => ({
    id: product.id,
    name: product.name,
    category: product.category ?? '',
    active: product.active,
    isFeatured: product.featured,
    displayOrder: product.sortOrder,
  }));
}

function messageForApiError(error: unknown, fallback: string): string {
  if (error instanceof AdminApiError) return error.message;
  return error instanceof Error ? error.message : fallback;
}

export function FeaturedProductsEditor() {
  const [products, setProducts] = useState<DraftProduct[] | null>(null);
  const [initialProducts, setInitialProducts] = useState<DraftProduct[] | null>(null);
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
        const draft = toDraft(loaded);
        setProducts(draft);
        setInitialProducts(draft);
      } catch (loadError) {
        if (mounted) setError(loadError instanceof Error ? loadError.message : 'No se pudieron cargar los productos.');
      } finally {
        if (mounted) setIsLoading(false);
      }
    }
    load();
    return () => {
      mounted = false;
    };
  }, []);

  const isDirty = useMemo(() => JSON.stringify(products) !== JSON.stringify(initialProducts), [products, initialProducts]);
  useEffect(() => setDirty('featured-products', isDirty), [isDirty, setDirty]);

  const featured = useMemo(
    () => (products ?? []).filter((product) => product.isFeatured).sort((a, b) => a.displayOrder - b.displayOrder),
    [products],
  );
  const notFeatured = useMemo(() => (products ?? []).filter((product) => !product.isFeatured), [products]);

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
      setMessage('Productos destacados actualizados correctamente.');
    } catch (submitError) {
      setError(messageForApiError(submitError, 'No se pudieron guardar los productos destacados.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="space-y-6 rounded-[2rem] border border-slate-200 bg-stone-50 p-5 sm:p-6">
      <header>
        <h3 className="text-lg font-semibold text-slate-900">Productos destacados</h3>
        <p className="mt-1 text-sm leading-6 text-slate-600">Elegí qué productos aparecen primero en la portada de la tienda, y en qué orden.</p>
      </header>

      {message ? <AdminNotice>{message}</AdminNotice> : null}
      {error ? (
        <p className="text-sm text-red-600" role="alert">
          {error}
        </p>
      ) : null}

      {isLoading ? (
        <div aria-busy="true" className="rounded-2xl border border-slate-200 bg-white p-5 text-sm text-slate-600">
          Cargando productos...
        </div>
      ) : (
        <form className="space-y-6" onSubmit={handleSubmit}>
          <div>
            <h4 className="text-sm font-semibold text-slate-800">Productos que se mostrarán</h4>
            {featured.length === 0 ? (
              <p className="mt-2 text-xs text-slate-500">Todavía no elegiste ningún producto destacado.</p>
            ) : (
              <ul className="mt-3 space-y-2">
                {featured.map((product, index) => (
                  <li key={product.id} className="flex items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-3">
                    <span className="text-sm font-medium text-slate-900">{product.name}</span>
                    <span className="flex items-center gap-2">
                      <button
                        type="button"
                        disabled={index === 0}
                        onClick={() => moveFeatured(product.id, -1)}
                        aria-label={`Mover ${product.name} antes`}
                        className="min-h-11 min-w-11 rounded-full border border-slate-300 text-xs font-medium text-slate-700 transition hover:border-slate-900 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        disabled={index === featured.length - 1}
                        onClick={() => moveFeatured(product.id, 1)}
                        aria-label={`Mover ${product.name} después`}
                        className="min-h-11 min-w-11 rounded-full border border-slate-300 text-xs font-medium text-slate-700 transition hover:border-slate-900 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        ↓
                      </button>
                      <button
                        type="button"
                        onClick={() => toggleFeatured(product.id, false)}
                        className="min-h-11 rounded-full border border-slate-300 px-3 text-xs font-medium text-slate-700 transition hover:border-slate-900"
                      >
                        Quitar
                      </button>
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-2 text-xs leading-5 text-slate-500">El orden de aparición acá es el mismo con el que se ordenan los productos en toda la tienda.</p>
          </div>

          <div>
            <h4 className="text-sm font-semibold text-slate-800">Otros productos</h4>
            <ul className="mt-3 space-y-2">
              {notFeatured.map((product) => {
                const eligible = canBeFeatured(product);
                const reason = !product.active
                  ? 'Este producto está oculto. Mostralo en Productos antes de destacarlo.'
                  : isReservedCategory(product.category)
                    ? 'Los productos de prueba no pueden mostrarse públicamente.'
                    : null;
                return (
                  <li key={product.id} className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-slate-200 bg-white p-3">
                    <span className="text-sm text-slate-800">
                      {product.name}
                      {!product.active ? <span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-500">Oculto</span> : null}
                    </span>
                    <span className="flex flex-col items-end gap-1">
                      <button
                        type="button"
                        disabled={!eligible}
                        onClick={() => toggleFeatured(product.id, true)}
                        className="min-h-11 rounded-full border border-slate-300 px-3 text-xs font-medium text-slate-700 transition hover:border-slate-900 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        Destacar
                      </button>
                      {reason ? <span className="text-[11px] text-slate-500">{reason}</span> : null}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>

          <FormActions onCancel={handleCancel} saving={saving} submitLabel="Guardar" />
        </form>
      )}
    </section>
  );
}
