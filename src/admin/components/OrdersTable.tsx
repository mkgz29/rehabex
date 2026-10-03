import { useEffect, useState } from 'react';
import { MessageCircle } from 'lucide-react';

import { useAuth } from '../../auth/useAuth';
import { formatCurrency } from '../../lib/format';
import { buildWhatsAppMessage, buildWhatsAppUrl, normalizePhoneForWhatsApp } from '../whatsapp';
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
// buyerLabel (used for the Comprador column) is deliberately not reused for
// the WhatsApp greeting: it falls back to the email or "sin datos" for
// display, neither of which belongs in a message sent to the customer -- the
// action only renders when a real customer_name exists (see
// OrderWhatsAppAction below).

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

/**
 * Compact, declarative "Contactar" link -- no editable message here (unlike
 * Soporte's WhatsAppContactButton), since a dense table row has no room for
 * one and the spec only asks for the fixed order template in this context.
 * Renders nothing at all when there is no phone, no customer_name to greet
 * with, or the phone does not normalize -- it never shows a broken link or a
 * disabled-looking control.
 */
export function OrderWhatsAppAction({ order }: { order: AdminOrder }) {
  const name = order.customer_name?.trim();
  const phone = order.customer_phone;
  if (!name || !phone) return null;

  const normalized = normalizePhoneForWhatsApp(phone);
  if (!normalized.ok) return null;

  const message = buildWhatsAppMessage(name, order.order_number);
  return (
    <a
      href={buildWhatsAppUrl(normalized.digits, message)}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-slate-300 text-slate-600 transition hover:border-slate-900 hover:text-slate-900"
      aria-label={`Contactar a ${name} por WhatsApp`}
      title={`Contactar a ${name} por WhatsApp`}
    >
      <MessageCircle aria-hidden="true" size={16} />
    </a>
  );
}

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
    return <AdminEmptyState title="Todavía no hay pedidos." />;
  }

  const needsAttention = orders.filter((order) => attentionLevel(order) === 'attention').length;

  return (
    <AdminCard padding="none" tone="muted" className="overflow-hidden">
      {needsAttention > 0 ? (
        <p className="border-b border-red-200 bg-red-50 px-5 py-3 text-sm font-semibold text-red-700" aria-live="polite">
          {needsAttention} {needsAttention === 1 ? 'pedido requiere' : 'pedidos requieren'} revisión: pago aprobado sin confirmar, retención o devolución pendiente.
        </p>
      ) : null}
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
              <th className="px-4 py-4">Acciones</th>
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
                <td className="px-4 py-4"><OrderWhatsAppAction order={order} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </AdminCard>
  );
}
