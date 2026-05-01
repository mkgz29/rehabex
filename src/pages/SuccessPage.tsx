import { PaymentResultPage } from './PaymentResultPage';

export function SuccessPage() {
  return (
    <PaymentResultPage
      title="Pago aprobado"
      description="Recibimos la confirmacion del pago. Te enviaremos las novedades de tu compra por los canales de contacto registrados."
      tone="success"
      actionLabel="Volver a la tienda"
      actionTo="/"
    />
  );
}
