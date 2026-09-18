import type { RecoveryOutcome } from './orderStatusService';

/** Explains what the server-to-server recovery attempt found, in plain terms. */
export function recoveryNotice(recovery: RecoveryOutcome | null, retryAfterSeconds: number | null): string | null {
  const wait = retryAfterSeconds && retryAfterSeconds > 0 ? ` Volve a intentar en ${retryAfterSeconds} segundos.` : '';
  switch (recovery) {
    case 'confirmed':
      return 'Consultamos a Mercado Pago desde el servidor y registramos la confirmacion.';
    case 'no_payment_found':
      return 'Consultamos a Mercado Pago y todavia no hay un pago asociado a esta orden.';
    case 'ambiguous_payments':
      return 'Detectamos mas de un pago para esta orden. No vamos a procesarlo automaticamente: un operador lo revisa. No vuelvas a pagar.';
    case 'cooldown':
      return `Ya consultamos a Mercado Pago hace instantes.${wait}`;
    case 'rate_limited':
      return `Hiciste muchas consultas seguidas.${wait}`;
    case 'provider_unavailable':
    case 'unreachable':
      return 'No pudimos consultar a Mercado Pago en este momento. Tu pedido queda igual y podes reintentar.';
    default:
      return null;
  }
}
