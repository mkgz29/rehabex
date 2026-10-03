import { useMemo, useState } from 'react';
import { MessageCircle } from 'lucide-react';

import { buildWhatsAppMessage, buildWhatsAppUrl, normalizePhoneForWhatsApp } from '../whatsapp';
import { AdminSecondaryButton } from './AdminButton';

type WhatsAppContactButtonProps = {
  phone: string | undefined;
  customerName: string;
  orderNumber?: string | null;
};

/**
 * Assisted contact only: opens a wa.me link with a preloaded, editable
 * message in a new tab. Never sends anything itself, never touches the
 * ticket's status or notes, never calls any API -- clicking "Abrir
 * WhatsApp" has no network effect at all.
 */
export function WhatsAppContactButton({ phone, customerName, orderNumber }: WhatsAppContactButtonProps) {
  const normalized = useMemo(() => (phone ? normalizePhoneForWhatsApp(phone) : null), [phone]);
  const defaultMessage = useMemo(() => buildWhatsAppMessage(customerName, orderNumber), [customerName, orderNumber]);
  const [message, setMessage] = useState(defaultMessage);

  if (!phone) return null;

  if (!normalized?.ok) {
    return <p className="text-xs text-slate-500">No se pudo abrir WhatsApp con este número.</p>;
  }

  return (
    <div className="space-y-2">
      <label className="block text-xs font-medium text-slate-600">
        Mensaje de WhatsApp
        <textarea
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          rows={2}
          className="admin-input mt-1"
        />
      </label>
      <AdminSecondaryButton
        size="sm"
        onClick={() => {
          window.open(buildWhatsAppUrl(normalized.digits, message), '_blank', 'noopener,noreferrer');
        }}
      >
        <MessageCircle aria-hidden="true" size={14} className="mr-1.5" />
        Abrir WhatsApp
      </AdminSecondaryButton>
    </div>
  );
}
