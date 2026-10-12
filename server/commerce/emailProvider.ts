// FASE 7E-B2: Resend integration via plain `fetch` to its REST API --
// deliberately no SDK. The entire surface this project needs is one POST
// with a JSON body and a bearer token; Node's global fetch (Vercel's
// runtime already has it) covers that completely, so an SDK would only add
// a dependency for something a dozen lines of code already does, with no
// extra type-safety this module doesn't already provide itself.
//
// This file is the only thing in the codebase that may construct a request
// carrying EMAIL_PROVIDER_API_KEY. It must never log the key, the recipient,
// the subject, the HTML/text body, or Resend's raw response body (which can
// echo back the recipient and content) -- only sanitized, allowlisted
// outcome codes ever leave this module into logs or the database.

const RESEND_API_URL = 'https://api.resend.com/emails';
const EMAIL_FORMAT = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Accepts either "name@domain" or "Display Name <name@domain>".
const FROM_FORMAT = /^(?:[^<>]+<([^\s@<>]+@[^\s@<>]+\.[^\s@<>]+)>|([^\s@<>]+@[^\s@<>]+\.[^\s@<>]+))$/;

export type EmailProviderConfig = {
  apiKey: string;
  from: string;
  replyTo?: string;
};

export type EmailConfigResult = { ok: true; config: EmailProviderConfig } | { ok: false; errorCode: 'configuration_missing' };

/**
 * Validates EMAIL_PROVIDER_API_KEY/EMAIL_FROM/EMAIL_REPLY_TO. Server-side
 * only, never a VITE_ variable (see .env.example). On any missing/malformed
 * value this returns a controlled, sanitized failure instead of throwing --
 * the caller marks the send attempt 'failed' with this error_code, the
 * payment itself is never affected by a configuration problem.
 */
export function loadEmailProviderConfig(): EmailConfigResult {
  const apiKey = process.env.EMAIL_PROVIDER_API_KEY?.trim();
  const from = process.env.EMAIL_FROM?.trim();
  const replyToRaw = process.env.EMAIL_REPLY_TO?.trim();

  if (!apiKey || !from || !FROM_FORMAT.test(from)) return { ok: false, errorCode: 'configuration_missing' };
  if (replyToRaw && !EMAIL_FORMAT.test(replyToRaw)) return { ok: false, errorCode: 'configuration_missing' };

  return { ok: true, config: { apiKey, from, replyTo: replyToRaw || undefined } };
}

export type SendEmailInput = {
  to: string;
  from: string;
  replyTo?: string;
  subject: string;
  html: string;
  text: string;
};

export type SendEmailResult =
  | { ok: true; providerMessageId: string }
  | { ok: false; errorCode: 'invalid_recipient' | 'provider_rejected' | 'provider_unavailable' | 'unexpected_provider_response' };

/**
 * One POST to Resend's REST API. Normalizes every outcome into a sanitized
 * result -- the raw provider response (which can carry the recipient back
 * in an error body) never reaches the caller, logs, or the database; only
 * the stable error_code does.
 */
export async function sendTransactionalEmail(apiKey: string, input: SendEmailInput): Promise<SendEmailResult> {
  if (!EMAIL_FORMAT.test(input.to)) return { ok: false, errorCode: 'invalid_recipient' };

  let response: Response;
  try {
    response = await fetch(RESEND_API_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: input.from,
        to: input.to,
        subject: input.subject,
        html: input.html,
        text: input.text,
        ...(input.replyTo ? { reply_to: input.replyTo } : {}),
      }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    // Network error, DNS failure, or the 10s timeout above firing (an
    // AbortError) -- never the exception itself, which could embed the
    // request (recipient, body) in its message.
    return { ok: false, errorCode: 'provider_unavailable' };
  }

  if (response.status >= 500) return { ok: false, errorCode: 'provider_unavailable' };
  if (response.status >= 400) return { ok: false, errorCode: 'provider_rejected' };
  if (response.status < 200 || response.status >= 300) return { ok: false, errorCode: 'unexpected_provider_response' };

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return { ok: false, errorCode: 'unexpected_provider_response' };
  }

  const id = (body as { id?: unknown } | null)?.id;
  if (typeof id !== 'string' || !id) return { ok: false, errorCode: 'unexpected_provider_response' };

  return { ok: true, providerMessageId: id };
}
