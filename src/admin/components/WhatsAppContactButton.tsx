import { MessageCircle } from 'lucide-react';
import { useId, useState } from 'react';

import { buildWhatsAppUrl, normalizePhoneForWhatsApp } from '../whatsapp';
import { AdminIconButton } from './AdminIconButton';
import { AdminSecondaryButton } from './AdminButton';

export type WhatsAppContactButtonProps = {
  phone: string | null | undefined;
  /** Already built via buildSupportWhatsAppMessage or buildOrderWhatsAppMessage -- this component only handles phone validation, the expand/edit/open UI and URL building, so the same component serves both Soporte and Pedidos with their own templates. */
  defaultMessage: string;
};

type WhatsAppContactViewProps = {
  isOpen: boolean;
  message: string;
  url: string | null;
  textareaId: string;
  onToggle: () => void;
  onMessageChange: (value: string) => void;
  onCancel: () => void;
};

/**
 * Pure, prop-driven panel -- no state of its own. Split out from
 * WhatsAppContactButton so every reachable state (collapsed, expanded with
 * a given message) can be rendered directly via props in tests, the same
 * pattern this codebase already uses for SupportIntakeView.
 */
export function WhatsAppContactView({ isOpen, message, url, textareaId, onToggle, onMessageChange, onCancel }: WhatsAppContactViewProps) {
  return (
    <div>
      {/* Icon-only: an obvious, repeated action in Soporte's contact row and
          Pedidos' table -- see AdminIconButton. lucide-react has no WhatsApp
          brand glyph, so this uses a generic message icon, same as the
          project's own existing "Seleccioná una consulta" empty state. */}
      <AdminIconButton icon={MessageCircle} label="Contactar por WhatsApp" tone="whatsapp" size="sm" aria-expanded={isOpen} onClick={onToggle} />
      {isOpen ? (
        <div className="mt-2 space-y-2 rounded-2xl border border-slate-200 bg-stone-50 p-3">
          <label htmlFor={textareaId} className="block text-xs font-medium text-slate-600">
            Mensaje de WhatsApp
          </label>
          <textarea
            id={textareaId}
            value={message}
            onChange={(event) => onMessageChange(event.target.value)}
            rows={3}
            className="admin-input"
          />
          {/* A plain link, not a button with a click handler: opening this
              tab is the only effect -- there is no fetch, no API call, no
              status change, nothing that could ever register a false
              "contacted" state. Icon+text here: a primary, infrequent
              confirmation action, not a repeated row control. */}
          <div className="flex flex-wrap gap-2">
            <a href={url ?? undefined} target="_blank" rel="noopener noreferrer" className="brand-button gap-2 px-4 text-sm">
              <MessageCircle aria-hidden="true" className="h-4 w-4" />
              Abrir WhatsApp
            </a>
            <AdminSecondaryButton size="sm" onClick={onCancel}>
              Cancelar
            </AdminSecondaryButton>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Assisted contact only: never opens WhatsApp on the first click -- it
 * first expands an editable, preloaded message, and only the explicit
 * "Abrir WhatsApp" link (opened in a new tab) goes to wa.me. Renders
 * nothing when there is no phone; renders a discreet notice, never a
 * broken link, when the phone does not normalize.
 *
 * Callers must pass `key={<the ticket's or order's own id>}` when rendering
 * this (see SupportRequestDetail and OrdersTable) -- that forces a fresh
 * mount, and therefore a fresh default message and a collapsed panel,
 * whenever the selected ticket/row changes. Without it, an edited draft for
 * one customer could otherwise stay loaded when switching to another, since
 * isOpen/message are local state.
 */
export function WhatsAppContactButton({ phone, defaultMessage }: WhatsAppContactButtonProps) {
  const textareaId = useId();
  const [isOpen, setIsOpen] = useState(false);
  const [message, setMessage] = useState(defaultMessage);

  if (!phone) return null;

  const digits = normalizePhoneForWhatsApp(phone);
  if (!digits) {
    return <p className="text-xs text-slate-500">No se pudo abrir WhatsApp con este número.</p>;
  }

  const url = buildWhatsAppUrl(phone, message);

  return (
    <WhatsAppContactView
      isOpen={isOpen}
      message={message}
      url={url}
      textareaId={textareaId}
      onToggle={() => {
        // Re-seed the prearmed message every time the panel opens, so a
        // closed-without-sending draft never resurfaces as if it were new.
        if (!isOpen) setMessage(defaultMessage);
        setIsOpen((open) => !open);
      }}
      onMessageChange={setMessage}
      onCancel={() => setIsOpen(false)}
    />
  );
}
