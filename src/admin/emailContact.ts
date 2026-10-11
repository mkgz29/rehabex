// Assisted Gmail contact core (FASE 7D.2). Pure logic only: no fetch, no
// Supabase, no window access, no side effects, no OAuth, no Gmail API, no
// credentials of any kind. This only ever builds a Gmail compose URL the
// admin opens by hand in a new tab -- the message stays fully editable
// inside Gmail's own compose window before the admin decides to send it.

const DEFAULT_BRAND_NAME = 'Rehabex';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Structural plausibility only, same spirit as the phone check in
 * whatsapp.ts -- rejects obviously malformed input without trying to fully
 * validate deliverability. */
export function isPlausibleEmail(email: string): boolean {
  return EMAIL_PATTERN.test(email.trim());
}

export function buildSupportEmailSubject(subject?: string | null, brandName: string = DEFAULT_BRAND_NAME): string {
  const trimmed = subject?.trim();
  return trimmed ? `Consulta ${brandName} — ${trimmed}` : `Consulta ${brandName}`;
}

export function buildSupportEmailBody(customerName: string, brandName: string = DEFAULT_BRAND_NAME): string {
  const name = customerName.trim();
  return `Hola ${name},\n\nSomos de ${brandName}. Te contactamos por la consulta que nos enviaste.\n\nSaludos,\n${brandName}`;
}

/**
 * https://mail.google.com/mail/?view=cm&fs=1&to=...&su=...&body=..., built
 * with URLSearchParams so subject/body are always correctly encoded and can
 * never inject an extra query parameter. Returns null (no link) when the
 * email does not look like a real address, so a caller never gets a broken
 * Gmail compose URL.
 */
export function buildGmailComposeUrl(email: string, subject: string, body: string): string | null {
  const trimmed = email.trim();
  if (!isPlausibleEmail(trimmed)) return null;
  const url = new URL('https://mail.google.com/mail/');
  url.searchParams.set('view', 'cm');
  url.searchParams.set('fs', '1');
  url.searchParams.set('to', trimmed);
  url.searchParams.set('su', subject);
  url.searchParams.set('body', body);
  return url.toString();
}
