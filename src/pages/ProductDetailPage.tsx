import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';

import { useCart } from '../cart/useCart';
import { Footer } from '../components/Footer';
import { formatCurrency } from '../lib/format';
import { getProductById } from '../services/cms';
import type { Product } from '../types/cms';

export function ProductDetailPage() {
  const { id } = useParams();
  const [product, setProduct] = useState<Product | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [addedToCart, setAddedToCart] = useState(false);
  const { addItem } = useCart();

  useEffect(() => {
    let mounted = true;

    async function loadProduct() {
      if (!id) {
        setProduct(null);
        setLoading(false);
        return;
      }

      setLoading(true);
      setError(null);

      try {
        const loadedProduct = await getProductById(id);
        if (mounted) {
          setProduct(loadedProduct);
        }
      } catch (loadError) {
        if (mounted) {
          setError(loadError instanceof Error ? loadError.message : 'No se pudo cargar el producto.');
        }
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    }

    loadProduct();

    return () => {
      mounted = false;
    };
  }, [id]);

  const handleAddToCart = () => {
    if (!product) {
      return;
    }

    addItem({
      productId: product.id,
      name: product.name,
      price: product.price,
      imageUrl: product.imageUrl,
    });
    setAddedToCart(true);
  };

  return (
    <div className="min-h-screen bg-white text-slate-900">
      <main className="px-4 py-12 sm:px-6 sm:py-16 lg:px-8">
        <section className="mx-auto w-full max-w-7xl">
          <Link to="/tienda" className="brand-link inline-flex text-sm font-semibold">
            {'<-'} Volver a tienda
          </Link>

          {loading ? (
            <div className="mt-10 rounded-2xl border border-slate-200 bg-stone-50 p-6 text-sm font-medium text-slate-600">
              Cargando producto...
            </div>
          ) : null}

          {!loading && error ? (
            <div className="mt-10 rounded-2xl border border-red-200 bg-red-50 p-6 text-sm text-red-700">{error}</div>
          ) : null}

          {!loading && !error && !product ? (
            <div className="mt-10 rounded-2xl border border-slate-200 bg-stone-50 p-6">
              <h1 className="text-2xl font-semibold tracking-tight text-slate-950">Producto no encontrado</h1>
              <p className="mt-3 text-sm leading-6 text-slate-600">
                El producto solicitado no existe o ya no esta disponible.
              </p>
            </div>
          ) : null}

          {!loading && !error && product ? (
            <article className="mt-10 grid gap-8 lg:grid-cols-[minmax(0,1.05fr)_minmax(380px,0.95fr)] lg:items-start">
              <div className="overflow-hidden rounded-2xl border border-slate-200 bg-slate-100">
                <img src={product.imageUrl} alt={product.name} className="aspect-[4/3] h-full w-full object-cover object-center" />
              </div>

              <div className="lg:pt-4">
                {product.category ? (
                  <p className="text-xs font-semibold uppercase tracking-[0.28em] text-slate-500">{product.category}</p>
                ) : null}
                <h1 className="mt-4 text-4xl font-semibold tracking-tight text-slate-950 sm:text-5xl">{product.name}</h1>
                <p className="mt-5 text-2xl font-semibold text-slate-950">{formatCurrency(product.price)}</p>
                <p className="mt-6 whitespace-pre-line text-base leading-8 text-slate-600">{product.description}</p>

                <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                  {/* TODO: conectar este boton al carrito o checkout cuando exista ese flujo. */}
                  <button
                    type="button"
                    onClick={handleAddToCart}
                    className="inline-flex flex-1 items-center justify-center rounded-full bg-slate-900 px-5 py-3 text-sm font-semibold text-white transition hover:[background-color:var(--color-primary-dark)]"
                  >
                    Comprar
                  </button>
                  <Link
                    to="/tienda"
                    className="inline-flex flex-1 items-center justify-center rounded-full border border-slate-300 px-5 py-3 text-center text-sm font-semibold text-slate-700 transition hover:border-slate-900 hover:text-slate-950"
                  >
                    Volver a tienda
                  </Link>
                </div>
                {addedToCart ? (
                  <div className="mt-4 flex flex-col gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800 sm:flex-row sm:items-center sm:justify-between">
                    <span className="font-medium">Producto agregado al carrito.</span>
                    <Link to="/carrito" className="font-semibold underline underline-offset-4">
                      Ver carrito
                    </Link>
                  </div>
                ) : null}
              </div>
            </article>
          ) : null}
        </section>
      </main>
      <Footer />
    </div>
  );
}
