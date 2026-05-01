import { PaymentResultPage } from './PaymentResultPage';

export function FailurePage() {
  return (
    <PaymentResultPage
      title="Pago rechazado"
      description="Mercado Pago no pudo aprobar la operacion. Revisa el medio de pago o intenta nuevamente desde el carrito."
      tone="failure"
      actionLabel="Reintentar compra"
      actionTo="/carrito"
    />
  );
}
