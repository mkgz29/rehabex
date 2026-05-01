import { useEffect, useState } from 'react';

import { useAuth } from '../../auth/useAuth';
import { formatCurrency } from '../../lib/format';

type OrderItem = {
  title?: unknown;
  quantity?: unknown;
};

type Order = {
  id?: string;
  payment_id?: string | null;
  status?: string | null;
  amount?: number | string | null;
  payer_email?: string | null;
  created_at?: string | null;
  items?: unknown;
};

const statusStyles: Record<string, string> = {
  approved: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  pending: 'bg-amber-50 text-amber-700 ring-amber-200',
  rejected: 'bg-red-50 text-red-700 ring-red-200',
  cancelled: 'bg-slate-100 text-slate-600 ring-slate-200',
};

export function OrdersTable() {
  const { session } = useAuth();
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;

    async function loadOrders() {
      if (!session?.access_token) {
        setOrders([]);
        setError('No hay una sesion activa para consultar ventas.');
        setLoading(false);
        return;
      }

      setLoading(true);
      setError(null);

      try {
        const response = await fetch('/api/orders', {
          headers: {
            Authorization: `Bearer ${session.access_token}`,
          },
        });
        const payload = (await response.json()) as { orders?: Order[]; error?: string };

        if (!response.ok) {
          throw new Error(payload.error || 'No se pudieron cargar las ordenes.');
        }

        if (mounted) {
          setOrders(Array.isArray(payload.orders) ? payload.orders : []);
        }
      } catch (loadError) {
        if (mounted) {
          setError(loadError instanceof Error ? loadError.message : 'No se pudieron cargar las ordenes.');
        }
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    }

    loadOrders();

    return () => {
      mounted = false;
    };
  }, [session?.access_token]);

  if (loading) {
    return (
      <div className="rounded-[2rem] border border-slate-200 bg-stone-50 p-5 text-sm font-medium text-slate-600">
        Cargando órdenes...
      </div>
    );
  }

  if (error) {
    return <div className="rounded-[2rem] border border-red-200 bg-red-50 p-5 text-sm text-red-700">{error}</div>;
  }

  if (orders.length === 0) {
    return (
      <div className="rounded-[2rem] border border-slate-200 bg-stone-50 p-5 text-sm text-slate-600">
        No hay órdenes aún
      </div>
    );
  }

  return (
    <section className="overflow-hidden rounded-[2rem] border border-slate-200 bg-stone-50">
      <div className="overflow-x-auto">
        <table className="min-w-[920px] w-full border-collapse text-left text-sm">
          <thead className="bg-white text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
            <tr>
              <th className="px-4 py-4">Email</th>
              <th className="px-4 py-4">Estado</th>
              <th className="px-4 py-4">Monto</th>
              <th className="px-4 py-4">Payment ID</th>
              <th className="px-4 py-4">Fecha</th>
              <th className="px-4 py-4">Items</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200 bg-stone-50">
            {orders.map((order) => (
              <tr key={order.payment_id ?? order.id} className="align-top">
                <td className="px-4 py-4 font-medium text-slate-900">{order.payer_email || 'Sin email'}</td>
                <td className="px-4 py-4">
                  <StatusBadge status={order.status} />
                </td>
                <td className="px-4 py-4 font-semibold text-slate-950">{formatOrderAmount(order.amount)}</td>
                <td className="max-w-[180px] break-words px-4 py-4 font-mono text-xs text-slate-600">
                  {order.payment_id || 'Sin ID'}
                </td>
                <td className="px-4 py-4 text-slate-600">{formatDate(order.created_at)}</td>
                <td className="px-4 py-4 text-slate-700">{formatItems(order.items)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function StatusBadge({ status }: { status?: string | null }) {
  const normalizedStatus = status || 'sin estado';
  const className = statusStyles[normalizedStatus] ?? 'bg-slate-100 text-slate-600 ring-slate-200';

  return (
    <span className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ring-1 ${className}`}>
      {normalizedStatus}
    </span>
  );
}

function formatOrderAmount(amount: Order['amount']) {
  const value = Number(amount);
  return Number.isFinite(value) ? formatCurrency(value) : formatCurrency(0);
}

function formatDate(value: string | null | undefined) {
  if (!value) {
    return 'Sin fecha';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return 'Sin fecha';
  }

  return new Intl.DateTimeFormat('es-AR', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(date);
}

function formatItems(items: unknown) {
  if (!Array.isArray(items) || items.length === 0) {
    return 'Sin items';
  }

  return items
    .map((item) => {
      const orderItem = item as OrderItem;
      const title = typeof orderItem.title === 'string' && orderItem.title.trim() ? orderItem.title.trim() : 'Producto';
      const quantity = Number(orderItem.quantity);
      const safeQuantity = Number.isFinite(quantity) && quantity > 0 ? quantity : 1;

      return `${title} x${safeQuantity}`;
    })
    .join(', ');
}
