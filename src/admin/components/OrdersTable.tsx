import { useEffect, useState } from 'react';

import { useAuth } from '../../auth/useAuth';
import { formatCurrency } from '../../lib/format';
import {
  attentionLevel,
  buyerLabel,
  formatOrderDate,
  orderAmount,
  orderItemsLabel,
  orderLabel,
  orderReference,
  paymentLabel,
  paymentReference,
  type AdminOrder,
  type AttentionLevel,
} from '../orderPresentation';

const paymentStyles: Record<string, string> = {
  approved: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  pending: 'bg-amber-50 text-amber-700 ring-amber-200',
  unpaid: 'bg-slate-100 text-slate-600 ring-slate-200',
  rejected: 'bg-red-50 text-red-700 ring-red-200',
  cancelled: 'bg-slate-100 text-slate-600 ring-slate-200',
  refunded: 'bg-sky-50 text-sky-700 ring-sky-200',
  charged_back: 'bg-red-50 text-red-700 ring-red-200',
};

const rowStyles: Record<AttentionLevel, string> = {
  settled: '',
  waiting: 'bg-amber-50/40',
  attention: 'bg-red-50/60',
};

export function OrdersTable() {
  const { session } = useAuth();
  const [orders, setOrders] = useState<AdminOrder[]>([]);
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
        const response = await fetch('/api/orders', { headers: { Authorization: `Bearer ${session.access_token}` } });
        const payload = (await response.json()) as { orders?: AdminOrder[]; error?: string };
        if (!response.ok) throw new Error(payload.error || 'No se pudieron cargar las ordenes.');
        if (mounted) setOrders(Array.isArray(payload.orders) ? payload.orders : []);
      } catch (loadError) {
        if (mounted) setError(loadError instanceof Error ? loadError.message : 'No se pudieron cargar las ordenes.');
      } finally {
        if (mounted) setLoading(false);
      }
    }

    loadOrders();
    return () => { mounted = false; };
  }, [session?.access_token]);

  if (loading) {
    return <div className="rounded-[2rem] border border-slate-200 bg-stone-50 p-5 text-sm font-medium text-slate-600">Cargando órdenes...</div>;
  }
  if (error) {
    return <div className="rounded-[2rem] border border-red-200 bg-red-50 p-5 text-sm text-red-700">{error}</div>;
  }
  if (orders.length === 0) {
    return <div className="rounded-[2rem] border border-slate-200 bg-stone-50 p-5 text-sm text-slate-600">No hay órdenes aún</div>;
  }

  const needsAttention = orders.filter((order) => attentionLevel(order) === 'attention').length;

  return (
    <section className="overflow-hidden rounded-[2rem] border border-slate-200 bg-stone-50">
      {needsAttention > 0 ? (
        <p className="border-b border-red-200 bg-red-50 px-5 py-3 text-sm font-semibold text-red-700">
          {needsAttention} {needsAttention === 1 ? 'orden requiere' : 'órdenes requieren'} revisión: pago aprobado sin confirmar, retención o devolución pendiente.
        </p>
      ) : null}
      <div className="overflow-x-auto">
        <table className="min-w-[1040px] w-full border-collapse text-left text-sm">
          <thead className="bg-white text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
            <tr>
              <th className="px-4 py-4">Orden</th>
              <th className="px-4 py-4">Comprador</th>
              <th className="px-4 py-4">Pago</th>
              <th className="px-4 py-4">Orden</th>
              <th className="px-4 py-4">Monto</th>
              <th className="px-4 py-4">Payment ID</th>
              <th className="px-4 py-4">Fecha</th>
              <th className="px-4 py-4">Items</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200 bg-stone-50">
            {orders.map((order) => (
              <tr key={order.id ?? orderReference(order)} className={`align-top ${rowStyles[attentionLevel(order)]}`}>
                <td className="px-4 py-4 font-mono text-xs font-semibold text-slate-900">{orderReference(order)}</td>
                <td className="px-4 py-4 font-medium text-slate-900">{buyerLabel(order)}</td>
                <td className="px-4 py-4"><Badge label={paymentLabel(order)} className={paymentStyles[order.payment_status ?? ''] ?? 'bg-slate-100 text-slate-600 ring-slate-200'} /></td>
                <td className="px-4 py-4"><Badge label={orderLabel(order)} className="bg-slate-100 text-slate-600 ring-slate-200" /></td>
                <td className="px-4 py-4 font-semibold text-slate-950">{formatCurrency(orderAmount(order))}</td>
                <td className="max-w-[180px] break-words px-4 py-4 font-mono text-xs text-slate-600">{paymentReference(order)}</td>
                <td className="px-4 py-4 text-slate-600">{formatOrderDate(order.created_at)}</td>
                <td className="px-4 py-4 text-slate-700">{orderItemsLabel(order)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Badge({ label, className }: { label: string; className: string }) {
  return <span className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ring-1 ${className}`}>{label}</span>;
}
