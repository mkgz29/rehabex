import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

import { useCart } from '../cart/useCart';
import { Footer } from '../components/Footer';
import { formatCurrency } from '../lib/format';
import { getActiveProducts } from '../services/cms';
import type { Product } from '../types/cms';

export function StorePage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [addedProductId, setAddedProductId] = useState<string | null>(null);
  const { addItem } = useCart();

  useEffect(() => {
    let mounted = true;

    async function loadProducts() {
      setLoading(true);
      setError(null);

      try {
        const activeProducts = await getActiveProducts();
        if (mounted) {
          setProducts(activeProducts);
        }
      } catch (loadError) {
        if (mounted) {
          setError(loadError instanceof Error ? loadError.message : 'No se pudieron cargar los productos.');
        }
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    }

    loadProducts();

    return () => {
      mounted = false;
    };
  }, []);

  const handleAddToCart = (product: Product) => {
    addItem({
      id: product.id,
      name: product.name,
      price: product.price,
      imageUrl: product.imageUrl,
    });
    setAddedProductId(product.id);
    window.setTimeout(() => setAddedProductId(null), 1800);
  };

  return (
    <div className="min-h-screen bg-white text-slate-900">
      <main className="px-4 py-14 sm:px-6 sm:py-16 lg:px-8 lg:py-20">
        <section className="mx-auto w-full max-w-7xl">
          <div className="max-w-3xl">
            <p className="text-xs font-semibold uppercase tracking-[0.34em] text-slate-500">Catalogo Rehabex</p>
            <h1 className="mt-4 text-4xl font-semibold tracking-tight text-slate-950 sm:text-5xl">Tienda</h1>
            <p className="mt-5 max-w-2xl text-base leading-7 text-slate-600">
              Productos activos cargados desde el panel de administracion, listos para consulta y compra asistida.
            </p>
          </div>

          {loading ? (
            <div className="mt-12 rounded-2xl border border-slate-200 bg-stone-50 p-6 text-sm font-medium text-slate-600">
              Cargando productos...
            </div>
          ) : null}

          {!loading && error ? (
            <div className="mt-12 rounded-2xl border border-red-200 bg-red-50 p-6 text-sm text-red-700">{error}</div>
          ) : null}

          {!loading && !error && products.length === 0 ? (
            <div className="mt-12 rounded-2xl border border-slate-200 bg-stone-50 p-6 text-sm text-slate-600">
              No hay productos activos para mostrar en este momento.
            </div>
          ) : null}

          {!loading && !error && products.length > 0 ? (
            <div className="mt-12 grid gap-6 md:grid-cols-2 xl:grid-cols-3">
              {products.map((product) => (
                <article
                  key={product.id}
                  className="group flex min-h-full flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_22px_60px_rgba(15,23,42,0.06)] transition hover:-translate-y-1 hover:shadow-[0_28px_70px_rgba(15,23,42,0.1)]"
                >
                  <div className="aspect-[4/3] overflow-hidden bg-slate-100">
                    <img
                      src={product.imageUrl}
                      alt={product.name}
                      className="h-full w-full object-cover object-center transition duration-500 group-hover:scale-[1.03]"
                    />
                  </div>

                  <div className="flex flex-1 flex-col p-5">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        {product.category ? (
                          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">
                            {product.category}
                          </p>
                        ) : null}
                        <h2 className="mt-2 text-xl font-semibold tracking-tight text-slate-950">{product.name}</h2>
                      </div>
                      <p className="shrink-0 rounded-full bg-slate-100 px-3 py-1 text-sm font-semibold text-slate-900">
                        {formatCurrency(product.price)}
                      </p>
                    </div>

                    <p className="mt-4 line-clamp-4 text-sm leading-6 text-slate-600">{product.description}</p>

                    <div className="mt-auto flex flex-col gap-3 pt-6 sm:flex-row">
                      {/* TODO: conectar este boton al carrito o checkout cuando exista ese flujo. */}
                      <button
                        type="button"
                        onClick={() => handleAddToCart(product)}
                        className="inline-flex flex-1 items-center justify-center rounded-full bg-slate-900 px-4 py-3 text-sm font-semibold text-white transition hover:[background-color:var(--color-primary-dark)]"
                      >
                        Comprar
                      </button>
                      <Link
                        to={`/productos/${product.id}`}
                        className="inline-flex flex-1 items-center justify-center rounded-full border border-slate-300 px-4 py-3 text-center text-sm font-semibold text-slate-700 transition hover:border-slate-900 hover:text-slate-950"
                      >
                        Ver detalle
                      </Link>
                    </div>
                    {addedProductId === product.id ? (
                      <p className="mt-3 text-sm font-medium text-emerald-700">Producto agregado al carrito.</p>
                    ) : null}
                  </div>
                </article>
              ))}
            </div>
          ) : null}
        </section>
      </main>
      <Footer />
    </div>
  );
}
