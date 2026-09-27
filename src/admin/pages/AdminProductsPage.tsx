import { useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent } from 'react';

import { formatCurrency } from '../../lib/format';
import { hasSupabaseConfig } from '../../lib/supabase';
import { getProducts } from '../../services/cms';
import { AdminApiError, createProduct, setProductActive, updateProduct } from '../../services/adminApi';
import type { Product, ProductInput } from '../../types/cms';
import { AdminNotice } from '../components/AdminNotice';
import { AdminPageHeader } from '../components/AdminPageHeader';
import { FormActions } from '../components/FormActions';
import { FormField } from '../components/FormField';
import { ProductGalleryField } from '../components/ProductGalleryField';
import { buildCategoryDirectory, resolveCategoryInput } from '../catalog/categoryOptions';
import { isProductFormDirty } from '../catalog/productDirtyState';
import { filterProducts, type VisibilityFilter } from '../catalog/productListFilters';
import { firstErrorField, validateProductForm, type ProductFormErrors } from '../catalog/productFormValidation';
import type { GalleryDraftItem } from '../catalog/productGallery';
import { mergeProductIntoList, saveProduct } from '../catalog/productSaveOrchestration';
import { useUnsavedChanges } from '../unsavedChanges/UnsavedChangesContext';

const emptyProduct: ProductInput = {
  name: '',
  description: '',
  price: 0,
  imageUrl: '',
  category: '',
  featured: false,
  sortOrder: 0,
  active: false,
  gallery: [],
};

function messageForApiError(error: unknown, fallback: string) {
  if (error instanceof AdminApiError) return error.message;
  return error instanceof Error ? error.message : fallback;
}

export function AdminProductsPage() {
  const { setDirty, confirmDiscardIfDirty } = useUnsavedChanges();

  const [products, setProducts] = useState<Product[]>([]);
  const [productsLoading, setProductsLoading] = useState(true);
  const [productsError, setProductsError] = useState<string | null>(null);

  const [searchQuery, setSearchQuery] = useState('');
  const [visibilityFilter, setVisibilityFilter] = useState<VisibilityFilter>('all');
  const [categoryFilter, setCategoryFilter] = useState('');

  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<ProductInput>(emptyProduct);
  const [initialProduct, setInitialProduct] = useState<ProductInput>(emptyProduct);
  const [editingUpdatedAt, setEditingUpdatedAt] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<ProductFormErrors>({});
  const [saving, setSaving] = useState(false);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [pendingHideId, setPendingHideId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const nameRef = useRef<HTMLInputElement>(null);
  const descriptionRef = useRef<HTMLTextAreaElement>(null);
  const priceRef = useRef<HTMLInputElement>(null);
  const categoryRef = useRef<HTMLInputElement>(null);

  const fieldRefs = { name: nameRef, description: descriptionRef, price: priceRef, category: categoryRef } as const;

  const loadProducts = async () => {
    setProductsLoading(true);
    setProductsError(null);
    try {
      const productList = await getProducts();
      setProducts(productList);
    } catch (loadError) {
      // Never keep a stale or invented list on screen: only the error state shows.
      setProducts([]);
      setProductsError(loadError instanceof Error ? loadError.message : 'No pudimos cargar los productos.');
    } finally {
      setProductsLoading(false);
    }
  };

  useEffect(() => {
    loadProducts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const isDirty = isFormOpen && isProductFormDirty(editingProduct, initialProduct);
  useEffect(() => setDirty('products', isDirty), [isDirty, setDirty]);

  const categoryDirectory = useMemo(() => buildCategoryDirectory(products.map((product) => product.category)), [products]);
  const categoryOptions = useMemo(
    () => Array.from(categoryDirectory.values()).sort((a, b) => a.localeCompare(b)),
    [categoryDirectory],
  );

  const initialGalleryIds = useMemo(
    () => new Set((initialProduct.gallery ?? []).map((item) => item.mediaAssetId ?? item.url)),
    [initialProduct],
  );

  const visibleProducts = useMemo(
    () =>
      filterProducts(products, { query: searchQuery, visibility: visibilityFilter, category: categoryFilter }).sort(
        (a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name),
      ),
    [products, searchQuery, visibilityFilter, categoryFilter],
  );

  const openCreateForm = () => {
    if (!confirmDiscardIfDirty()) return;
    setEditingProduct(emptyProduct);
    setInitialProduct(emptyProduct);
    setEditingUpdatedAt(null);
    setFieldErrors({});
    setMessage(null);
    setError(null);
    setIsFormOpen(true);
  };

  const openEditForm = (product: Product) => {
    if (!confirmDiscardIfDirty()) return;
    const values: ProductInput = {
      id: product.id,
      name: product.name,
      description: product.description,
      price: product.price,
      imageUrl: product.imageUrl,
      category: product.category ?? '',
      featured: product.featured,
      sortOrder: product.sortOrder,
      active: product.active,
      gallery: product.gallery ?? [],
    };
    setEditingProduct(values);
    setInitialProduct(values);
    setEditingUpdatedAt(product.updatedAt ?? null);
    setFieldErrors({});
    setMessage(null);
    setError(null);
    setIsFormOpen(true);
  };

  const closeForm = () => {
    if (!confirmDiscardIfDirty()) return;
    setIsFormOpen(false);
    setDirty('products', false);
  };

  const updateField = <K extends keyof ProductInput>(field: K, value: ProductInput[K]) => {
    setEditingProduct((current) => ({ ...current, [field]: value }));
    setFieldErrors((current) => {
      if (!(field in current)) return current;
      const next = { ...current };
      delete next[field as keyof ProductFormErrors];
      return next;
    });
  };

  const resolveCategoryOnBlur = () => {
    setEditingProduct((current) => ({ ...current, category: resolveCategoryInput(current.category ?? '', categoryDirectory) }));
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (saving) return; // Prevents a double click from firing two saves.

    const resolvedCategory = resolveCategoryInput(editingProduct.category ?? '', categoryDirectory);
    const candidate: ProductInput = { ...editingProduct, category: resolvedCategory };

    const errors = validateProductForm({
      name: candidate.name,
      description: candidate.description,
      category: candidate.category ?? '',
      price: candidate.price,
    });
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      const target = firstErrorField(errors);
      if (target) fieldRefs[target].current?.focus();
      return;
    }

    setEditingProduct(candidate);
    setFieldErrors({});
    setSaving(true);
    setMessage(null);
    setError(null);

    const isNew = !candidate.id;

    try {
      // One request, one database transaction: content, gallery and
      // visibility are committed together or not at all (admin_create_product
      // _with_media / admin_update_product_with_media, ADMIN-02C).
      const saved = await saveProduct(candidate, { editingUpdatedAt, gallery: candidate.gallery ?? [] }, { createProduct, updateProduct });
      setProducts((current) => mergeProductIntoList(current, saved, isNew));
      setMessage(isNew ? 'Producto creado correctamente.' : 'Producto actualizado correctamente.');
      setIsFormOpen(false);
      setDirty('products', false);
    } catch (submitError) {
      // Nothing was persisted: a failure anywhere in the single save request
      // rolls back the whole transaction, so the form stays open with what
      // was typed and nothing changed on the server.
      setError(messageForApiError(submitError, 'No pudimos guardar los cambios. Revisa que todos los campos esten completos y sean validos.'));
    } finally {
      setSaving(false);
    }
  };

  const handleSetActive = async (product: Product, nextActive: boolean) => {
    setMessage(null);
    setError(null);
    setTogglingId(product.id);
    setPendingHideId(null);

    try {
      if (!product.updatedAt) throw new Error('No pudimos identificar la version actual del producto. Volve a cargar el listado.');
      const updated = await setProductActive(product.id, nextActive, product.updatedAt);
      // setProductActive never touches the gallery; keep the one already known locally.
      setProducts((current) => current.map((item) => (item.id === updated.id ? { ...updated, gallery: item.gallery } : item)));
      setMessage(updated.active ? 'Producto visible en la tienda.' : 'Producto oculto de la tienda.');
    } catch (toggleError) {
      setError(messageForApiError(toggleError, 'No pudimos actualizar la visibilidad del producto.'));
    } finally {
      setTogglingId(null);
    }
  };

  return (
    <div className="space-y-6">
      <AdminPageHeader title="Productos" description="Busca, crea y edita los productos de la tienda con formularios simples." />

      {!hasSupabaseConfig ? (
        <AdminNotice>El catalogo no esta disponible en este momento. Contacta al equipo tecnico.</AdminNotice>
      ) : null}

      {message ? <AdminNotice>{message}</AdminNotice> : null}
      {error ? (
        <p className="text-sm text-red-600" role="alert">
          {error}
        </p>
      ) : null}

      {!isFormOpen ? (
        <section className="space-y-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="grid gap-3 sm:flex sm:flex-1 sm:items-center">
              <label className="sr-only" htmlFor="product-search">
                Buscar producto por nombre
              </label>
              <input
                id="product-search"
                type="search"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="Buscar por nombre..."
                className="admin-input min-h-11 sm:max-w-xs"
              />

              <label className="sr-only" htmlFor="product-visibility-filter">
                Filtrar por estado
              </label>
              <select
                id="product-visibility-filter"
                value={visibilityFilter}
                onChange={(event) => setVisibilityFilter(event.target.value as VisibilityFilter)}
                className="admin-input min-h-11 sm:w-44"
              >
                <option value="all">Todos</option>
                <option value="visible">Visibles</option>
                <option value="hidden">Ocultos</option>
              </select>

              <label className="sr-only" htmlFor="product-category-filter">
                Filtrar por categoria
              </label>
              <select
                id="product-category-filter"
                value={categoryFilter}
                onChange={(event) => setCategoryFilter(event.target.value)}
                className="admin-input min-h-11 sm:w-48"
              >
                <option value="">Todas las categorias</option>
                {categoryOptions.map((category) => (
                  <option key={category} value={category}>
                    {category}
                  </option>
                ))}
              </select>
            </div>

            <button
              type="button"
              onClick={openCreateForm}
              className="brand-button inline-flex min-h-11 items-center justify-center rounded-full px-5 py-3 text-sm font-semibold"
            >
              Agregar producto
            </button>
          </div>

          {productsLoading ? (
            <div className="space-y-3" aria-busy="true">
              <span className="sr-only">Cargando productos...</span>
              {[0, 1, 2].map((key) => (
                <div key={key} className="h-24 animate-none rounded-2xl border border-slate-200 bg-stone-50" />
              ))}
            </div>
          ) : productsError ? (
            <div role="alert" className="flex flex-col items-center gap-4 rounded-2xl border border-red-200 bg-red-50 p-6 text-center">
              <p className="text-sm text-red-700">{productsError}</p>
              <button
                type="button"
                onClick={loadProducts}
                className="min-h-11 rounded-full border border-red-300 px-4 py-2 text-sm font-medium text-red-700 transition hover:border-red-500"
              >
                Reintentar
              </button>
            </div>
          ) : products.length === 0 ? (
            <div className="flex flex-col items-center gap-4 rounded-2xl border border-dashed border-slate-300 bg-stone-50 p-10 text-center">
              <p className="text-sm text-slate-600">Todavia no cargaste ningun producto.</p>
              <button
                type="button"
                onClick={openCreateForm}
                className="brand-button inline-flex min-h-11 items-center justify-center rounded-full px-5 py-3 text-sm font-semibold"
              >
                Agregar el primer producto
              </button>
            </div>
          ) : visibleProducts.length === 0 ? (
            <p className="rounded-2xl border border-dashed border-slate-300 bg-stone-50 p-6 text-center text-sm text-slate-600">
              No encontramos productos con esos filtros.
            </p>
          ) : (
            <div className="space-y-3">
              {visibleProducts.map((product) => (
                <article key={product.id} className="rounded-2xl border border-slate-200 bg-white p-4">
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex items-center gap-4">
                      {product.imageUrl ? (
                        <img src={product.imageUrl} alt={product.name} className="h-16 w-16 rounded-2xl object-cover object-center" />
                      ) : (
                        <div className="flex h-16 w-16 items-center justify-center rounded-2xl border border-dashed border-slate-300 bg-stone-50 text-[10px] text-slate-400">
                          Sin imagen
                        </div>
                      )}
                      <div>
                        <h4 className="text-sm font-semibold text-slate-900">{product.name}</h4>
                        <p className="mt-1 text-xs uppercase tracking-[0.2em] text-slate-400">{product.category || 'Sin categoria'}</p>
                        <p className="mt-1 text-xs text-slate-500">{formatCurrency(product.price)}</p>
                        <p className="mt-1 text-xs font-medium text-slate-600">
                          {product.active ? 'Visible en la tienda' : 'Oculto'}
                        </p>
                      </div>
                    </div>

                    {pendingHideId === product.id ? (
                      <div className="flex flex-col gap-2 sm:items-end">
                        <p className="text-xs text-slate-600">Ocultar este producto de la tienda?</p>
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={() => handleSetActive(product, false)}
                            disabled={togglingId === product.id}
                            className="min-h-11 rounded-full border border-slate-900 bg-slate-900 px-4 py-2 text-sm font-medium text-white transition disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            Si, ocultar
                          </button>
                          <button
                            type="button"
                            onClick={() => setPendingHideId(null)}
                            className="min-h-11 rounded-full border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition hover:border-slate-900"
                          >
                            Cancelar
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => openEditForm(product)}
                          className="min-h-11 rounded-full border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition hover:border-slate-900"
                        >
                          Editar
                        </button>
                        <button
                          type="button"
                          onClick={() => (product.active ? setPendingHideId(product.id) : handleSetActive(product, true))}
                          disabled={togglingId === product.id}
                          className="min-h-11 rounded-full border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition hover:border-slate-900 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {togglingId === product.id ? 'Actualizando...' : product.active ? 'Ocultar de la tienda' : 'Mostrar en la tienda'}
                        </button>
                      </div>
                    )}
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      ) : (
        <section className="rounded-[2rem] border border-slate-200 bg-stone-50 p-5">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold text-slate-900">{editingProduct.id ? 'Editar producto' : 'Nuevo producto'}</h3>
            <button
              type="button"
              onClick={closeForm}
              disabled={saving}
              className="min-h-11 text-sm font-medium text-slate-600 underline-offset-4 hover:underline disabled:cursor-not-allowed disabled:opacity-60 disabled:no-underline"
            >
              Volver al listado
            </button>
          </div>

          <form className="mt-5 space-y-6" onSubmit={handleSubmit} noValidate>
            <fieldset className="space-y-4">
              <legend className="text-sm font-semibold text-slate-800">Informacion principal</legend>
              <FormField label="Nombre">
                <input
                  ref={nameRef}
                  type="text"
                  value={editingProduct.name}
                  onChange={(event) => updateField('name', event.target.value)}
                  className="admin-input min-h-11"
                  aria-invalid={Boolean(fieldErrors.name)}
                  aria-describedby={fieldErrors.name ? 'product-name-error' : undefined}
                />
                {fieldErrors.name ? (
                  <p id="product-name-error" role="alert" className="mt-1 text-xs text-red-600">
                    {fieldErrors.name}
                  </p>
                ) : null}
              </FormField>

              <FormField label="Descripcion" hint="Opcional.">
                <textarea
                  ref={descriptionRef}
                  value={editingProduct.description}
                  onChange={(event) => updateField('description', event.target.value)}
                  rows={4}
                  className="admin-input"
                  aria-invalid={Boolean(fieldErrors.description)}
                  aria-describedby={fieldErrors.description ? 'product-description-error' : undefined}
                />
                {fieldErrors.description ? (
                  <p id="product-description-error" role="alert" className="mt-1 text-xs text-red-600">
                    {fieldErrors.description}
                  </p>
                ) : null}
              </FormField>
            </fieldset>

            <fieldset className="space-y-4">
              <legend className="text-sm font-semibold text-slate-800">Precio y categoria</legend>
              <FormField label="Precio" hint="Solo el numero, sin puntos ni simbolos.">
                <input
                  ref={priceRef}
                  type="number"
                  min="1"
                  value={editingProduct.price}
                  onChange={(event) => updateField('price', Number(event.target.value) || 0)}
                  className="admin-input min-h-11"
                  aria-invalid={Boolean(fieldErrors.price)}
                  aria-describedby={fieldErrors.price ? 'product-price-error' : undefined}
                />
                {fieldErrors.price ? (
                  <p id="product-price-error" role="alert" className="mt-1 text-xs text-red-600">
                    {fieldErrors.price}
                  </p>
                ) : null}
              </FormField>

              <FormField label="Categoria" hint="Elegi una categoria existente o escribi una nueva.">
                <input
                  ref={categoryRef}
                  type="text"
                  list="product-category-suggestions"
                  value={editingProduct.category ?? ''}
                  onChange={(event) => updateField('category', event.target.value)}
                  onBlur={resolveCategoryOnBlur}
                  className="admin-input min-h-11"
                  aria-invalid={Boolean(fieldErrors.category)}
                  aria-describedby={fieldErrors.category ? 'product-category-error' : undefined}
                />
                <datalist id="product-category-suggestions">
                  {categoryOptions.map((category) => (
                    <option key={category} value={category} />
                  ))}
                </datalist>
                {fieldErrors.category ? (
                  <p id="product-category-error" role="alert" className="mt-1 text-xs text-red-600">
                    {fieldErrors.category}
                  </p>
                ) : null}
              </FormField>
            </fieldset>

            <fieldset className="space-y-4">
              <legend className="text-sm font-semibold text-slate-800">Imágenes del producto</legend>
              <ProductGalleryField
                items={(editingProduct.gallery ?? []) as GalleryDraftItem[]}
                onChange={(nextGallery) => updateField('gallery', nextGallery)}
                persistedIds={initialGalleryIds}
              />
            </fieldset>

            <fieldset className="space-y-4">
              <legend className="text-sm font-semibold text-slate-800">Visibilidad</legend>

              <label className="flex min-h-11 items-center justify-between rounded-2xl border border-slate-300 bg-white px-4 py-3">
                <div>
                  <p className="text-sm font-medium text-slate-800">Visible en la tienda</p>
                  <p className="mt-1 text-xs text-slate-500">Si lo desmarcas, el producto queda oculto y nadie lo ve en la tienda.</p>
                </div>
                <input
                  type="checkbox"
                  checked={editingProduct.active}
                  onChange={(event) => updateField('active', event.target.checked)}
                  className="h-5 w-5 rounded border-slate-300 text-[var(--color-primary)] focus:ring-[var(--color-primary)]"
                />
              </label>

              <label className="flex min-h-11 items-center justify-between rounded-2xl border border-slate-300 bg-white px-4 py-3">
                <div>
                  <p className="text-sm font-medium text-slate-800">Mostrar como destacado</p>
                  <p className="mt-1 text-xs text-slate-500">Activalo para incluirlo en la seccion premium de la landing.</p>
                </div>
                <input
                  type="checkbox"
                  checked={editingProduct.featured}
                  onChange={(event) => updateField('featured', event.target.checked)}
                  className="h-5 w-5 rounded border-slate-300 text-[var(--color-primary)] focus:ring-[var(--color-primary)]"
                />
              </label>

              <FormField label="Orden de aparicion" hint="Menor numero = aparece antes entre los destacados.">
                <input
                  type="number"
                  min="0"
                  value={editingProduct.sortOrder}
                  onChange={(event) => updateField('sortOrder', Number(event.target.value) || 0)}
                  className="admin-input min-h-11"
                />
              </FormField>
            </fieldset>

            {isDirty ? (
              <p role="status" className="text-xs font-medium text-amber-700">
                Tenes cambios sin guardar.
              </p>
            ) : null}

            <FormActions onCancel={closeForm} saving={saving} submitLabel="Guardar producto" />
          </form>
        </section>
      )}
    </div>
  );
}
