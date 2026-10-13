import { MessageCircle } from 'lucide-react';

import { buildWhatsAppUrl } from '../admin/whatsapp';

// Fixed contact details for Rehabex's own public WhatsApp line -- this is
// not a per-order/per-ticket contact action (see src/admin/whatsapp.ts for
// that), so the phone and message are both constants, not props.
const REHABEX_WHATSAPP_PHONE = '+5491158624811';
const REHABEX_WHATSAPP_MESSAGE = 'Hola, vengo desde la web de Rehabex y quiero hacer una consulta.';

/**
 * Public-site floating contact button (fixed, bottom-right). Deliberately
 * presentational: the only logic is building the wa.me link via the
 * already-reviewed, pure buildWhatsAppUrl helper (shared with the admin's
 * assisted-contact flow) -- no state, no fetch, no side effects beyond the
 * anchor's own navigation.
 *
 * Mounted once in AppLayout, which only wraps the public route tree -- /admin
 * uses a separate AdminLayout under its own <Route>, so this never renders
 * there without needing any route-path check of its own.
 */
export function FloatingWhatsAppButton() {
  const url = buildWhatsAppUrl(REHABEX_WHATSAPP_PHONE, REHABEX_WHATSAPP_MESSAGE);
  if (!url) return null;

  return (
    <div className="group fixed bottom-5 right-5 z-float sm:bottom-6 sm:right-6">
      {/* Very subtle, slow glow pulse behind the button -- not on the logo
          itself, so the mark never looks distorted. Respects
          prefers-reduced-motion via motion-reduce:animate-none. */}
      <span
        aria-hidden="true"
        className="absolute inset-0 -z-10 animate-pulse rounded-full bg-emerald-400/40 blur-md motion-reduce:animate-none"
        style={{ animationDuration: '3s' }}
      />
      <span
        role="tooltip"
        className="pointer-events-none absolute right-full top-1/2 mr-3 hidden -translate-y-1/2 whitespace-nowrap rounded-full bg-dark px-3 py-1.5 text-xs font-semibold text-white opacity-0 shadow-soft transition-opacity duration-ui group-focus-within:opacity-100 group-hover:opacity-100 sm:block"
      >
        Escribinos por WhatsApp
      </span>
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        aria-label="Contactar a Rehabex por WhatsApp"
        className="relative flex h-14 w-14 items-center justify-center rounded-full bg-white shadow-lift ring-4 ring-emerald-400/70 transition hover:ring-emerald-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-500"
      >
        <img src="/brand/rehabex-mark-charcoal.svg" alt="" className="h-7 w-auto" />
        <span className="absolute -bottom-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full border-2 border-white bg-emerald-500">
          <MessageCircle aria-hidden="true" className="h-3 w-3 text-white" />
        </span>
      </a>
    </div>
  );
}
