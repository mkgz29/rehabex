import { useState } from 'react';

import { formatCurrency } from '../../lib/format';
import { updateOrderFulfillmentStatus } from '../../services/adminApi';
import type { AdminOrder } from '../orderPresentation';
import {
  FULFILLMENT_STATUS_LABELS,
  FULFILLMENT_TRANSITION_LABELS,
  buyerLabel,
  formatOrderDate,
  fulfillmentLabel,
  nextFulfillmentTransitions,
  orderAmount,
  orderLabel,
  orderReference,
  paymentLabel,
  type FulfillmentTransition,
} from '../orderPresentation';
import { buildOrderWhatsAppMessage } from '../whatsapp';
import { AdminCard } from './AdminCard';
import { AdminSecondaryButton } from './AdminButton';
import { GmailContactLink } from './GmailContactLink';
import { StatusBadge } from './StatusBadge';
import { WhatsAppContactButton } from './WhatsAppContactButton';

type OrderDetailPanelProps = {
  order: AdminOrder;
  onClose: () => void;
  onUpdated: (order: AdminOrder) => void;
};

/** Only the non-empty delivery/pickup lines -- never a literal "null"/empty row, same convention as the purchase email template. */
function deliveryLines(order: AdminOrder): string[] {
  if (order.delivery_method === 'pickup') {
    return [order.pickup_location_label, order.pickup_window].filter((line): line is string => Boolean(line?.trim()));
  }
  return [
    order.delivery_recipient_name,
    order.delivery_address_line1,
    order.delivery_address_line2,
    [order.delivery_city, order.delivery_province].filter(Boolean).join(', ') || null,
    order.delivery_postal_code,
    order.delivery_notes,
  ].filter((line): line is string => Boolean(line?.trim()));
}

export function OrderDetailPanel({ order, onClose, onUpdated }: OrderDetailPanelProps) {
  const [pendingTransition, setPendingTransition] = useState<FulfillmentTransition | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const transitions = nextFulfillmentTransitions(order);
  const items = Array.isArray(order.order_items) ? (order.order_items as Array<{ product_name?: unknown; quantity?: unknown; unit_price?: unknown }>) : [];
  const history = Array.isArray(order.order_fulfillment_events) ? order.order_fulfillment_events : [];

  const applyTransition = async (toStatus: FulfillmentTransition) => {
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      const updated = await updateOrderFulfillmentStatus(order.id ?? '', toStatus, null);
      onUpdated(updated);
      setPendingTransition(null);
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : 'No pudimos actualizar el estado del pedido.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <AdminCard className="space-y-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold text-slate-900">Pedido {orderReference(order)}</h3>
          <p className="mt-1 text-xs text-slate-500">{formatOrderDate(order.created_at)}</p>
        </div>
        <AdminSecondaryButton onClick={onClose}>Cerrar</AdminSecondaryButton>
      </div>

      <section aria-label="Comprador" className="grid gap-4 sm:grid-cols-2">
        <div>
          <h4 className="text-sm font-semibold text-slate-900">Comprador</h4>
          <dl className="mt-2 space-y-1 text-sm">
            <div className="flex gap-2"><dt className="text-slate-500">Nombre:</dt><dd className="font-medium text-slate-900">{buyerLabel(order)}</dd></div>
            <div className="flex gap-2"><dt className="text-slate-500">Email:</dt><dd className="font-medium text-slate-900">{order.customer_email || 'sin datos'}</dd></div>
            <div className="flex gap-2"><dt className="text-slate-500">Teléfono:</dt><dd className="font-medium text-slate-900">{order.customer_phone || 'No informado'}</dd></div>
          </dl>
          <div className="mt-3 flex flex-wrap items-start gap-2">
            <WhatsAppContactButton
              key={order.id}
              phone={order.customer_phone}
              defaultMessage={buildOrderWhatsAppMessage(order.customer_name?.trim() || '', orderReference(order))}
            />
            <GmailContactLink email={order.customer_email} customerName={order.customer_name?.trim() || 'cliente'} subject={`Pedido ${orderReference(order)}`} />
          </div>
        </div>

        <div>
          <h4 className="text-sm font-semibold text-slate-900">{order.delivery_method === 'pickup' ? 'Retiro en local' : 'Envío'}</h4>
          <div className="mt-2 space-y-1 text-sm text-slate-700">
            {deliveryLines(order).length > 0 ? deliveryLines(order).map((line, index) => <p key={index}>{line}</p>) : <p className="text-slate-500">Sin datos de entrega.</p>}
          </div>
        </div>
      </section>

      <section aria-label="Productos" className="border-t border-slate-200 pt-4">
        <h4 className="text-sm font-semibold text-slate-900">Productos</h4>
        <ul className="mt-2 space-y-1 text-sm text-slate-700">
          {items.map((item, index) => (
            <li key={index} className="flex justify-between gap-2">
              <span>{String(item.product_name ?? 'producto')} x{Number(item.quantity) || 1}</span>
              <span className="font-medium text-slate-900">{formatCurrency(Number(item.unit_price) || 0)}</span>
            </li>
          ))}
        </ul>
        <p className="mt-2 text-right text-sm font-semibold text-slate-950">Total: {formatCurrency(orderAmount(order))}</p>
      </section>

      <section aria-label="Estado" className="border-t border-slate-200 pt-4">
        <div className="flex flex-wrap gap-2">
          <StatusBadge label={paymentLabel(order)} tone="neutral" />
          <StatusBadge label={orderLabel(order)} tone="neutral" />
          <StatusBadge label={fulfillmentLabel(order)} tone="info" />
        </div>

        {transitions.length > 0 ? (
          <div className="mt-3 flex flex-wrap gap-2">
            {transitions.map((toStatus) =>
              pendingTransition === toStatus ? (
                <div key={toStatus} className="flex items-center gap-2 rounded-2xl border border-slate-300 bg-stone-50 px-3 py-2">
                  <span className="text-xs text-slate-600">¿Confirmar "{FULFILLMENT_TRANSITION_LABELS[toStatus]}"?</span>
                  <AdminSecondaryButton size="sm" disabled={saving} onClick={() => applyTransition(toStatus)}>
                    {saving ? 'Guardando...' : 'Confirmar'}
                  </AdminSecondaryButton>
                  <AdminSecondaryButton size="sm" onClick={() => setPendingTransition(null)}>Cancelar</AdminSecondaryButton>
                </div>
              ) : (
                <AdminSecondaryButton key={toStatus} size="sm" onClick={() => setPendingTransition(toStatus)}>
                  {FULFILLMENT_TRANSITION_LABELS[toStatus]}
                </AdminSecondaryButton>
              ),
            )}
          </div>
        ) : null}
        {error ? <p role="alert" className="mt-2 text-xs text-red-600">{error}</p> : null}
      </section>

      {history.length > 0 ? (
        <section aria-label="Historial de estado" className="border-t border-slate-200 pt-4">
          <h4 className="text-sm font-semibold text-slate-900">Historial</h4>
          <ul className="mt-2 space-y-1 text-sm text-slate-600">
            {history.map((event, index) => (
              <li key={index}>
                {FULFILLMENT_STATUS_LABELS[event.to_status] ?? event.to_status} — {formatOrderDate(event.created_at)}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </AdminCard>
  );
}
