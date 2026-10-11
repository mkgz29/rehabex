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
  /** Honeypot. Always sent; stays empty for a real visitor. */
  company?: string;
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
