import { ReceiptText } from 'lucide-react';
import { useEffect, useState } from 'react';

import { useAuth } from '../../auth/useAuth';
import { formatCurrency } from '../../lib/format';
import { AdminCard } from './AdminCard';
import { AdminEmptyState } from './AdminEmptyState';
import { StatusBadge } from './StatusBadge';
import {
  attentionLevel,
  buyerLabel,
  formatOrderDate,
  orderAmount,
  orderLabel,
  orderReference,
  paymentLabel,
  type AdminOrder,
  type AttentionLevel,
} from '../orderPresentation';

const paymentTones: Record<string, 'success' | 'warning' | 'danger' | 'neutral' | 'info'> = {
  approved: 'success',
  pending: 'warning',
  unpaid: 'neutral',
  rejected: 'danger',
  cancelled: 'neutral',
  refunded: 'info',
  charged_back: 'danger',
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
        setError('No hay una sesión activa para consultar pedidos.');
        setLoading(false);
        return;
      }

      setLoading(true);
      setError(null);
      try {
        const response = await fetch('/api/orders', { headers: { Authorization: `Bearer ${session.access_token}` } });
        const payload = (await response.json()) as { orders?: AdminOrder[]; error?: string };
        if (!response.ok) throw new Error(payload.error || 'No se pudieron cargar los pedidos.');
        if (mounted) setOrders(Array.isArray(payload.orders) ? payload.orders : []);
      } catch (loadError) {
        if (mounted) setError(loadError instanceof Error ? loadError.message : 'No se pudieron cargar los pedidos.');
      } finally {
        if (mounted) setLoading(false);
      }
    }

    loadOrders();
    return () => { mounted = false; };
  }, [session?.access_token]);

  if (loading) {
    return (
      <AdminCard tone="muted" aria-busy="true" className="text-sm font-medium text-slate-600">
        Cargando pedidos...
      </AdminCard>
    );
  }
  if (error) {
    return (
      <div role="alert" className="rounded-2xl border border-red-200 bg-red-50 p-5 text-sm text-red-700">
        {error}
      </div>
    );
  }
  if (orders.length === 0) {
    return (
      <AdminEmptyState
        icon={ReceiptText}
        title="Todavía no hay pedidos."
        description="Cuando alguien compre en la tienda, el pedido va a aparecer acá."
      />
    );
  }

  const needsAttention = orders.filter((order) => attentionLevel(order) === 'attention').length;
  const totalAmount = orders.reduce((total, order) => total + orderAmount(order), 0);

  return (
    <AdminCard padding="none" tone="muted" className="overflow-hidden">
      {needsAttention > 0 ? (
        <p className="border-b border-red-200 bg-red-50 px-5 py-3 text-sm font-semibold text-red-700" aria-live="polite">
          {needsAttention} {needsAttention === 1 ? 'pedido requiere' : 'pedidos requieren'} revisión: pago aprobado sin confirmar, retención o devolución pendiente.
        </p>
      ) : null}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-white px-5 py-3 text-sm">
        <span className="font-medium text-slate-700">{orders.length} {orders.length === 1 ? 'pedido' : 'pedidos'}</span>
        <span className="font-semibold text-slate-950">Total: {formatCurrency(totalAmount)}</span>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-[820px] w-full border-collapse text-left text-sm">
          <thead className="bg-white text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
            <tr>
              <th className="px-4 py-4">Pedido</th>
              <th className="px-4 py-4">Comprador</th>
              <th className="px-4 py-4">Pago</th>
              <th className="px-4 py-4">Estado</th>
              <th className="px-4 py-4">Fecha</th>
              <th className="px-4 py-4">Total</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200 bg-stone-50">
            {orders.map((order) => (
              <tr key={order.id ?? orderReference(order)} className={`align-top ${rowStyles[attentionLevel(order)]}`}>
                <td className="px-4 py-4 font-mono text-xs font-semibold text-slate-900">{orderReference(order)}</td>
                <td className="px-4 py-4 font-medium text-slate-900">{buyerLabel(order)}</td>
                <td className="px-4 py-4"><StatusBadge label={paymentLabel(order)} tone={paymentTones[order.payment_status ?? ''] ?? 'neutral'} /></td>
                <td className="px-4 py-4"><StatusBadge label={orderLabel(order)} tone="neutral" /></td>
                <td className="px-4 py-4 text-slate-600">{formatOrderDate(order.created_at)}</td>
                <td className="px-4 py-4 font-semibold text-slate-950">{formatCurrency(orderAmount(order))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </AdminCard>
  );
}
