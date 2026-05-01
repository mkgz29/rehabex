import { useSearchParams } from 'react-router-dom';

export type PaymentResult = {
  paymentId: string | null;
  status: string | null;
  externalReference: string | null;
};

export function usePaymentResult(): PaymentResult {
  const [searchParams] = useSearchParams();

  return {
    paymentId: getParam(searchParams, 'payment_id'),
    status: getParam(searchParams, 'status'),
    externalReference: getParam(searchParams, 'external_reference'),
  };
}

function getParam(searchParams: URLSearchParams, key: string) {
  const value = searchParams.get(key)?.trim();
  return value ? value : null;
}
