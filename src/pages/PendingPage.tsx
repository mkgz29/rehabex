import { PaymentResultPage } from './PaymentResultPage';

export function PendingPage() {
  return (
    <PaymentResultPage
      title="Pago pendiente"
      description="El pago esta siendo revisado o aun no fue confirmado. Cuando Mercado Pago actualice el estado, continuaremos con el proceso."
      tone="pending"
      actionLabel="Volver a la tienda"
      actionTo="/"
    />
  );
}
