const WHATSAPP_PHONE_NUMBER = '5491100000000';
const WHATSAPP_MESSAGE = 'Hola, quiero consultar por productos de Rehabex.';

const whatsappHref = `https://wa.me/${WHATSAPP_PHONE_NUMBER}?text=${encodeURIComponent(WHATSAPP_MESSAGE)}`;

export function WhatsAppFloatingButton() {
  return (
    <a
      href={whatsappHref}
      target="_blank"
      rel="noreferrer"
      aria-label="Consultar por WhatsApp"
      className="fixed bottom-4 right-4 z-50 inline-flex h-14 w-14 items-center justify-center rounded-full bg-[#25D366] text-white shadow-[0_18px_40px_rgba(37,211,102,0.35)] transition hover:scale-105 hover:bg-[#20ba5a] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#25D366] sm:bottom-5 sm:right-5"
    >
      <span className="sr-only">Consultar por WhatsApp</span>
      <svg viewBox="0 0 24 24" className="h-7 w-7" aria-hidden="true" fill="currentColor">
        <path d="M19.05 4.91A9.82 9.82 0 0 0 12.03 2C6.61 2 2.2 6.4 2.2 11.82c0 1.73.45 3.42 1.31 4.92L2 22l5.41-1.42a9.8 9.8 0 0 0 4.62 1.18h.01c5.42 0 9.83-4.4 9.83-9.82a9.75 9.75 0 0 0-2.82-7.03Zm-7.01 15.2h-.01a8.13 8.13 0 0 1-4.14-1.13l-.3-.18-3.21.84.86-3.13-.2-.32a8.1 8.1 0 0 1-1.25-4.35c0-4.49 3.66-8.15 8.16-8.15 2.18 0 4.23.84 5.77 2.38a8.1 8.1 0 0 1 2.39 5.78c0 4.49-3.66 8.15-8.17 8.15Zm4.47-6.1c-.24-.12-1.44-.7-1.66-.78-.22-.08-.38-.12-.54.12-.16.24-.62.78-.76.94-.14.16-.28.18-.52.06-.24-.12-1-.37-1.91-1.18-.7-.63-1.18-1.41-1.32-1.65-.14-.24-.01-.37.11-.49.11-.11.24-.28.36-.42.12-.14.16-.24.24-.4.08-.16.04-.3-.02-.42-.06-.12-.54-1.3-.74-1.78-.2-.48-.4-.41-.54-.42h-.46c-.16 0-.42.06-.64.3-.22.24-.84.82-.84 2s.86 2.32.98 2.48c.12.16 1.69 2.58 4.1 3.62.57.25 1.02.4 1.37.52.58.18 1.1.16 1.51.1.46-.07 1.44-.59 1.64-1.16.2-.57.2-1.06.14-1.16-.06-.1-.22-.16-.46-.28Z" />
      </svg>
    </a>
  );
}
