import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

import { loadCheckoutSnapshot, type CheckoutSnapshot } from '../cart/checkoutSnapshot';
import { requestOrderStatus, type PaymentConfirmationState } from '../services/orderStatusService';

export type PaymentResult = {
  state: 'verifying' | PaymentConfirmationState;
  snapshot: CheckoutSnapshot | null;
  refresh: () => void;
};

export function usePaymentResult(): PaymentResult {
  const [searchParams] = useSearchParams();
  const orderId = orderIdFromRedirect(searchParams);
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<PaymentResult['state']>('verifying');
  const [snapshot, setSnapshot] = useState<CheckoutSnapshot | null>(null);

  useEffect(() => {
    const current = orderId ? loadCheckoutSnapshot(window.sessionStorage, orderId) : null;
    setSnapshot(current);
    if (!current) {
      setState('unknown');
      return;
    }
    let active = true;
    setState('verifying');
    requestOrderStatus(current)
      .then((next) => { if (active) setState(next); })
      .catch(() => { if (active) setState('unknown'); });
    return () => { active = false; };
  }, [attempt, orderId]);

  return {
    state,
    snapshot,
    refresh: useCallback(() => setAttempt((current) => current + 1), []),
  };
}

/** A redirect reference selects a local snapshot only; it never establishes payment state. */
export function orderIdFromRedirect(searchParams: URLSearchParams) {
  const value = searchParams.get('external_reference')?.trim() ?? '';
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value) ? value : null;
}
