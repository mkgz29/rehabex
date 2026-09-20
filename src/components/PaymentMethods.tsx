import amexMark from '../assets/payments/american-express.svg';
import mercadoPagoMark from '../assets/payments/mercadopago.svg';
import naranjaXMark from '../assets/payments/naranja-x.png';
import visaMark from '../assets/payments/visa.png';

type PaymentMethod = {
  name: string;
  src: string;
  /**
   * Optical height, not a raw one. A solid square badge reads much heavier than
   * a wide wordmark at the same pixel height, so each mark gets the height that
   * makes it sit at the same visual weight as the others. Nothing is stretched:
   * the chip is a fixed box and every logo keeps its own aspect ratio.
   */
  height: string;
};

const paymentMethods: PaymentMethod[] = [
  { name: 'Visa', src: visaMark, height: '1rem' },
  // Mastercard: falta el SVG oficial. Ver src/assets/payments/SOURCES.md.
  // { name: 'Mastercard', src: mastercardMark, height: '1.375rem' },
  { name: 'American Express', src: amexMark, height: '1.375rem' },
  { name: 'Naranja X', src: naranjaXMark, height: '0.875rem' },
  { name: 'Mercado Pago', src: mercadoPagoMark, height: '1.1875rem' },
];

export function PaymentMethods() {
  return (
    <div data-reveal-item className="flex flex-col gap-4 sm:flex-row sm:items-center sm:gap-7">
      <p id="footer-payment-methods" className="text-xs font-bold uppercase tracking-[0.18em] text-white/55">
        Medios de pago
      </p>

      <ul aria-labelledby="footer-payment-methods" className="flex flex-wrap items-center gap-2.5">
        {paymentMethods.map((method) => (
          <li
            key={method.name}
            className="flex h-9 w-20 items-center justify-center rounded-md border border-white/10 bg-white px-2.5"
          >
            <img
              src={method.src}
              alt={method.name}
              loading="lazy"
              decoding="async"
              style={{ height: method.height }}
              className="w-auto max-w-full object-contain"
            />
          </li>
        ))}
      </ul>
    </div>
  );
}
