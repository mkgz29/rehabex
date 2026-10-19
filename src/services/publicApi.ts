// Browser-side client for anonymous, unauthenticated public endpoints.
// Deliberately separate from src/services/adminApi.ts: this code ships to
// every visitor, never carries a session token, and must never import
// Supabase or the service-role concept. The only call here is a plain fetch
// to a public Vercel function -- see api/support-intake.ts.
import type { SupportTopic } from '../support/supportTopics';

export class PublicApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export type SupportIntakeInput = {
  customerName: string;
  customerEmail: string;
  customerPhone?: string;
  topic: SupportTopic;
  subject?: string;
  orderReference?: string;
  message: string;
  /** Honeypot. Always sent; stays empty for a real visitor. Deliberately
   * non-semantic name (FASE 7D.1-E) -- never rename this back to something
   * that resembles a real form field (company, email, phone, address...),
   * since that is exactly what made a real visitor's browser autofill
   * silently fill it and get misread as a bot. */
  formGuard?: string;
};

export async function submitSupportRequest(input: SupportIntakeInput): Promise<void> {
  let response: Response;
  try {
    response = await fetch('/api/support-intake', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
  } catch {
    throw new PublicApiError(0, 'No pudimos conectar con el servidor.');
  }

  if (!response.ok) {
    throw new PublicApiError(response.status, 'No pudimos enviar tu consulta.');
  }
}

export type WithdrawalRequestInput = {
  customerName: string;
  customerEmail: string;
  customerPhone?: string;
  orderReference: string;
  message?: string;
  formGuard?: string;
};

export async function submitWithdrawalRequest(input: WithdrawalRequestInput): Promise<{ requestCode: string }> {
  let response: Response;
  try {
    response = await fetch('/api/withdrawal-request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
  } catch {
    throw new PublicApiError(0, 'No pudimos conectar con el servidor.');
  }

  if (!response.ok) {
    throw new PublicApiError(response.status, 'No pudimos registrar la solicitud.');
  }

  let body: { requestCode?: unknown };
  try {
    body = (await response.json()) as { requestCode?: unknown };
  } catch {
    throw new PublicApiError(500, 'El servidor no devolvio una respuesta valida.');
  }
  if (typeof body.requestCode !== 'string' || !/^ARR-\d{8}-[A-F0-9]{8}$/.test(body.requestCode)) {
    throw new PublicApiError(500, 'El servidor no devolvio un codigo de tramite valido.');
  }
  return { requestCode: body.requestCode };
}
