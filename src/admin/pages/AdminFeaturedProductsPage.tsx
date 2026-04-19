import { useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';

import { hasSupabaseConfig } from '../../lib/supabase';
import { getLandingContent, getProducts, saveFeaturedProductIds } from '../../services/cms';
import type { Product } from '../../types/cms';
import { AdminNotice } from '../components/AdminNotice';
import { AdminPageHeader } from '../components/AdminPageHeader';
import { FormActions } from '../components/FormActions';

export function AdminFeaturedProductsPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [initialIds, setInitialIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const [content, productList] = await Promise.all([getLandingContent(), getProducts()]);
        setProducts(productList);
        setSelectedIds(content.featuredProductIds.slice(0, 3));
        setInitialIds(content.featuredProductIds.slice(0, 3));
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : 'No se pudieron cargar los destacados.');
      }
    }

    load();
  }, []);

  const activeProducts = useMemo(() => products.filter((product) => product.active), [products]);
  const selectedProducts = selectedIds
    .map((id) => activeProducts.find((product) => product.id === id))
    .filter((product): product is Product => Boolean(product));

  const toggleProduct = (productId: string) => {
    setSelectedIds((current) => {
      if (current.includes(productId)) {
        return current.filter((id) => id !== productId);
      }

      if (current.length >= 3) {
        return current;
      }

      return [...current, productId];
    });
  };

  const moveProduct = (productId: string, direction: 'up' | 'down') => {
    setSelectedIds((current) => {
      const index = current.findIndex((id) => id === productId);
      if (index === -1) {
        return current;
      }

      const nextIndex = direction === 'up' ? index - 1 : index + 1;
      if (nextIndex < 0 || nextIndex >= current.length) {
        return current;
      }

      const next = [...current];
      [next[index], next[nextIndex]] = [next[nextIndex], next[index]];
      return next;
    });
  };

  const handleCancel = () => {
    setSelectedIds(initialIds);
    setMessage(null);
    setError(null);
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    setMessage(null);
    setError(null);

    try {
      await saveFeaturedProductIds(selectedIds);
      setInitialIds(selectedIds);
      setMessage(
        hasSupabaseConfig
          ? 'Destacados guardados correctamente.'
          : 'Vista local actualizada. Configura Supabase para persistir los cambios.',
      );
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'No se pudieron guardar los destacados.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="Productos destacados"
        description="Elige hasta 3 productos activos y ordenalos visualmente para la landing."
      />

      {!hasSupabaseConfig ? (
        <AdminNotice>
          Estas viendo datos de ejemplo. Para guardar de forma permanente, agrega `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY`.
        </AdminNotice>
      ) : null}

      {message ? <AdminNotice>{message}</AdminNotice> : null}
      {error ? <p className="text-sm text-red-600">{error}</p> : null}

      <form className="space-y-6" onSubmit={handleSubmit}>
        <section className="rounded-[2rem] border border-slate-200 bg-stone-50 p-5">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold text-slate-900">Seleccion actual</h3>
            <span className="text-sm text-slate-500">{selectedIds.length} de 3 elegidos</span>
          </div>

          <div className="mt-5 space-y-3">
            {selectedProducts.map((product, index) => (
              <div key={product.id} className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-4">
                  <img src={product.imageUrl} alt={product.name} className="h-16 w-16 rounded-2xl object-cover object-center" />
                  <div>
                    <p className="text-sm font-semibold text-slate-900">{product.name}</p>
                    <p className="mt-1 text-xs text-slate-500">Posicion {index + 1}</p>
                  </div>
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => moveProduct(product.id, 'up')}
                    className="rounded-full border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition hover:border-slate-900"
                  >
                    Subir
                  </button>
                  <button
                    type="button"
                    onClick={() => moveProduct(product.id, 'down')}
                    className="rounded-full border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition hover:border-slate-900"
                  >
                    Bajar
                  </button>
                  <button
                    type="button"
                    onClick={() => toggleProduct(product.id)}
                    className="rounded-full border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition hover:border-slate-900"
                  >
                    Quitar
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="rounded-[2rem] border border-slate-200 bg-stone-50 p-5">
          <h3 className="text-lg font-semibold text-slate-900">Productos disponibles</h3>
          <div className="mt-5 grid gap-3 lg:grid-cols-2">
            {activeProducts.map((product) => {
              const selected = selectedIds.includes(product.id);

              return (
                <button
                  key={product.id}
                  type="button"
                  onClick={() => toggleProduct(product.id)}
                  className={`flex items-center gap-4 rounded-2xl border p-4 text-left transition ${
                    selected ? 'brand-accent-soft brand-accent-border' : 'border-slate-200 bg-white hover:border-slate-300'
                  }`}
                >
                  <img src={product.imageUrl} alt={product.name} className="h-16 w-16 rounded-2xl object-cover object-center" />
                  <div>
                    <p className="text-sm font-semibold text-slate-900">{product.name}</p>
                    <p className="mt-1 text-xs leading-5 text-slate-500">{product.description}</p>
                  </div>
                </button>
              );
            })}
          </div>
        </section>

        <FormActions onCancel={handleCancel} saving={saving} />
      </form>
    </div>
  );
}
