import { useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';

import { defaultProducts } from '../../lib/defaultContent';
import { formatCurrency } from '../../lib/format';
import { hasSupabaseConfig } from '../../lib/supabase';
import { deleteProduct, getProducts, saveProduct } from '../../services/cms';
import type { Product, ProductInput } from '../../types/cms';
import { AdminNotice } from '../components/AdminNotice';
import { AdminPageHeader } from '../components/AdminPageHeader';
import { FormActions } from '../components/FormActions';
import { FormField } from '../components/FormField';
import { ImageField } from '../components/ImageField';

const emptyProduct: ProductInput = {
  name: '',
  description: '',
  price: 0,
  imageUrl: '',
  category: '',
  featured: false,
  sortOrder: 0,
  active: true,
};

export function AdminProductsPage() {
  const [products, setProducts] = useState<Product[]>(defaultProducts);
  const [editingProduct, setEditingProduct] = useState<ProductInput>(emptyProduct);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const productList = await getProducts();
        setProducts(productList);
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : 'No se pudieron cargar los productos.');
      }
    }

    load();
  }, []);

  const sortedProducts = useMemo(
    () =>
      [...products].sort(
        (a, b) =>
          Number(b.active) - Number(a.active) ||
          Number(b.featured) - Number(a.featured) ||
          a.sortOrder - b.sortOrder ||
          a.name.localeCompare(b.name),
      ),
    [products],
  );

  const handleEdit = (product: Product) => {
    setEditingProduct({
      id: product.id,
      name: product.name,
      description: product.description,
      price: product.price,
      imageUrl: product.imageUrl,
      category: product.category ?? '',
      featured: product.featured,
      sortOrder: product.sortOrder,
      active: product.active,
    });
    setMessage(null);
    setError(null);
  };

  const handleCancel = () => {
    setEditingProduct(emptyProduct);
    setMessage(null);
    setError(null);
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    setMessage(null);
    setError(null);

    try {
      await saveProduct(editingProduct);
      const productList = await getProducts();
      setProducts(productList);
      setEditingProduct(emptyProduct);
      setMessage(
        hasSupabaseConfig
          ? 'Producto guardado correctamente.'
          : 'Vista local actualizada. Configura Supabase para persistir los cambios.',
      );
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'No se pudo guardar el producto.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (productId: string) => {
    setMessage(null);
    setError(null);

    try {
      await deleteProduct(productId);
      setProducts((current) => current.filter((product) => product.id !== productId));
      if (editingProduct.id === productId) {
        setEditingProduct(emptyProduct);
      }
      setMessage(
        hasSupabaseConfig
          ? 'Producto eliminado correctamente.'
          : 'Vista local actualizada. Configura Supabase para persistir los cambios.',
      );
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : 'No se pudo eliminar el producto.');
    }
  };

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="Productos"
        description="Administra imagen, contenido comercial, estado de destacado y orden de aparicion de cada producto."
      />

      {!hasSupabaseConfig ? (
        <AdminNotice>
          Estas viendo datos de ejemplo. Para guardar de forma permanente, agrega `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY`.
        </AdminNotice>
      ) : null}

      {message ? <AdminNotice>{message}</AdminNotice> : null}
      {error ? <p className="text-sm text-red-600">{error}</p> : null}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.1fr)_minmax(360px,420px)]">
        <section className="rounded-[2rem] border border-slate-200 bg-stone-50 p-5">
          <h3 className="text-lg font-semibold text-slate-900">Listado</h3>
          <div className="mt-5 space-y-3">
            {sortedProducts.map((product) => (
              <article key={product.id} className="rounded-2xl border border-slate-200 bg-white p-4">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex items-center gap-4">
                    <img src={product.imageUrl} alt={product.name} className="h-16 w-16 rounded-2xl object-cover object-center" />
                    <div>
                      <h4 className="text-sm font-semibold text-slate-900">{product.name}</h4>
                      <p className="mt-1 text-xs uppercase tracking-[0.2em] text-slate-400">
                        {product.category || 'Sin categoria'}
                      </p>
                      <p className="mt-1 text-xs text-slate-500">{formatCurrency(product.price)}</p>
                      <p className="mt-1 text-xs text-slate-500">
                        {product.featured ? `Destacado - Orden ${product.sortOrder}` : 'No destacado'}
                      </p>
                      <p className="mt-1 text-xs text-slate-500">{product.active ? 'Activo' : 'Inactivo'}</p>
                    </div>
                  </div>

                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => handleEdit(product)}
                      className="rounded-full border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition hover:border-slate-900"
                    >
                      Editar
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDelete(product.id)}
                      className="rounded-full border border-red-200 px-4 py-2 text-sm font-medium text-red-600 transition hover:bg-red-50"
                    >
                      Eliminar
                    </button>
                  </div>
                </div>
              </article>
            ))}
          </div>
        </section>

        <section className="rounded-[2rem] border border-slate-200 bg-stone-50 p-5">
          <h3 className="text-lg font-semibold text-slate-900">
            {editingProduct.id ? 'Editar producto' : 'Nuevo producto'}
          </h3>

          <form className="mt-5 space-y-4" onSubmit={handleSubmit}>
            <FormField label="Nombre">
              <input
                type="text"
                value={editingProduct.name}
                onChange={(event) => setEditingProduct((current) => ({ ...current, name: event.target.value }))}
                className="admin-input"
                required
              />
            </FormField>

            <FormField label="Descripcion" hint="Opcional.">
              <textarea
                value={editingProduct.description}
                onChange={(event) => setEditingProduct((current) => ({ ...current, description: event.target.value }))}
                rows={4}
                className="admin-input"
              />
            </FormField>

            <FormField label="Categoria" hint="Opcional. Texto corto encima del nombre en la card.">
              <input
                type="text"
                value={editingProduct.category ?? ''}
                onChange={(event) => setEditingProduct((current) => ({ ...current, category: event.target.value }))}
                className="admin-input"
              />
            </FormField>

            <FormField label="Precio" hint="Solo ingresa el numero, sin puntos ni simbolos.">
              <input
                type="number"
                min="1"
                value={editingProduct.price}
                onChange={(event) =>
                  setEditingProduct((current) => ({ ...current, price: Number(event.target.value) || 0 }))
                }
                className="admin-input"
                required
              />
            </FormField>

            <ImageField
              label="Imagen"
              value={editingProduct.imageUrl}
              onChange={(value) => setEditingProduct((current) => ({ ...current, imageUrl: value }))}
            />

            <FormField label="Orden de aparicion" hint="Menor numero = aparece antes entre los destacados.">
              <input
                type="number"
                min="0"
                value={editingProduct.sortOrder}
                onChange={(event) =>
                  setEditingProduct((current) => ({ ...current, sortOrder: Number(event.target.value) || 0 }))
                }
                className="admin-input"
              />
            </FormField>

            <label className="flex items-center justify-between rounded-2xl border border-slate-300 bg-white px-4 py-3">
              <div>
                <p className="text-sm font-medium text-slate-800">Mostrar como destacado</p>
                <p className="mt-1 text-xs text-slate-500">Activalo para incluirlo en la seccion premium de la landing.</p>
              </div>
              <input
                type="checkbox"
                checked={editingProduct.featured}
                onChange={(event) => setEditingProduct((current) => ({ ...current, featured: event.target.checked }))}
                className="h-5 w-5 rounded border-slate-300 text-[var(--color-primary)] focus:ring-[var(--color-primary)]"
              />
            </label>

            <label className="flex items-center justify-between rounded-2xl border border-slate-300 bg-white px-4 py-3">
              <div>
                <p className="text-sm font-medium text-slate-800">Mostrar en catalogo</p>
                <p className="mt-1 text-xs text-slate-500">Desactivalo si no quieres que aparezca en la landing.</p>
              </div>
              <input
                type="checkbox"
                checked={editingProduct.active}
                onChange={(event) => setEditingProduct((current) => ({ ...current, active: event.target.checked }))}
                className="h-5 w-5 rounded border-slate-300 text-[var(--color-primary)] focus:ring-[var(--color-primary)]"
              />
            </label>

            <FormActions onCancel={handleCancel} saving={saving} />
          </form>
        </section>
      </div>
    </div>
  );
}
