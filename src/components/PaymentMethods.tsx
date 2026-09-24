import amexMark from '../assets/payments/american-express.svg';
import mercadoPagoMark from '../assets/payments/mercadopago.svg';
import naranjaXMark from '../assets/payments/naranja-x.png';
import visaMark from '../assets/payments/visa.png';

type PaymentMethod = {
  name: string;
  src: string;
  accessibleName: string;
  intrinsicWidth: number;
  intrinsicHeight: number;
  opticalClassName: string;
  kind: 'card' | 'platform';
};

const paymentMethods: PaymentMethod[] = [
  {
    name: 'Visa',
    accessibleName: 'Visa',
    src: visaMark,
    intrinsicWidth: 208,
    intrinsicHeight: 68,
    opticalClassName: 'h-4',
    kind: 'card',
  },
  // Mastercard: falta el SVG oficial. Ver src/assets/payments/SOURCES.md.
  {
    name: 'American Express',
    accessibleName: 'American Express',
    src: amexMark,
    intrinsicWidth: 45,
    intrinsicHeight: 45,
    opticalClassName: 'h-[1.375rem]',
    kind: 'card',
  },
  {
    name: 'Naranja X',
    accessibleName: 'Naranja X',
    src: naranjaXMark,
    intrinsicWidth: 155,
    intrinsicHeight: 36,
    opticalClassName: 'h-[0.875rem]',
    kind: 'card',
  },
  {
    name: 'Mercado Pago',
    accessibleName: 'Mercado Pago, plataforma de pago',
    src: mercadoPagoMark,
    intrinsicWidth: 1049,
    intrinsicHeight: 425,
    opticalClassName: 'h-[1.1875rem]',
    kind: 'platform',
  },
];

export function PaymentMethods() {
  return (
    <div data-reveal-item className="flex flex-col gap-4 sm:flex-row sm:items-center sm:gap-7">
      <p id="footer-payment-methods" className="text-xs font-bold uppercase tracking-[0.18em] text-white/55">
        Medios de pago
      </p>

      <ul aria-labelledby="footer-payment-methods" className="flex flex-wrap items-center justify-center gap-2.5 sm:justify-start">
        {paymentMethods.map((method) => (
          <li
            key={method.name}
            data-payment-method={method.name}
            data-payment-kind={method.kind}
            aria-label={method.accessibleName}
            className="flex h-9 w-[5.25rem] items-center justify-center rounded-md border border-white/10 bg-white px-2.5"
          >
            <span className="flex h-[1.375rem] w-16 items-center justify-center">
              <img
                src={method.src}
                alt=""
                aria-hidden="true"
                width={method.intrinsicWidth}
                height={method.intrinsicHeight}
                loading="lazy"
                decoding="async"
                className={`${method.opticalClassName} w-auto max-w-full object-contain`}
              />
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
