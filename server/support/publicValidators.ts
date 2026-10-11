// Server-only, dependency-free payload validation for the public Support
// intake endpoint (ADMIN-03B). Deliberately separate from
// server/admin/validators.ts: this is anonymous, unauthenticated input, with
// its own allowed-keys set and its own error vocabulary -- it must never
// accidentally inherit an admin-only field or convention.

export type ValidationResult<T> = { ok: true; value: T } | { ok: false; error: string };

export function isValid<T>(result: ValidationResult<T>): result is { ok: true; value: T } {
  return result.ok === true;
}

const MAX_PUBLIC_NAME = 160;
const MAX_PUBLIC_EMAIL = 254;
const MAX_PUBLIC_PHONE = 40;
const MAX_PUBLIC_SUBJECT = 200;
const MAX_PUBLIC_ORDER_REFERENCE = 60;
const MAX_PUBLIC_MESSAGE = 4000;

const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export const SUPPORT_TOPICS = ['product', 'order', 'shipping', 'payment', 'returns_warranty', 'advice', 'general', 'other'] as const;
export type SupportTopic = (typeof SUPPORT_TOPICS)[number];

const ALLOWED_KEYS = ['customerName', 'customerEmail', 'customerPhone', 'topic', 'subject', 'orderReference', 'message', 'formGuard'] as const;

export type PublicSupportIntakeInput = {
  customerName: string;
  customerEmail: string;
  customerPhone: string | null;
  topic: SupportTopic;
  subject: string | null;
  orderReference: string | null;
  message: string;
  /** true if the honeypot field came back filled -- the caller must fake a
   * success response and skip the RPC entirely, never reveal detection. */
  honeypotTriggered: boolean;
};

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function hasOnlyAllowedKeys(input: Record<string, unknown>, allowed: readonly string[]) {
  return !Object.keys(input).some((key) => !allowed.includes(key));
}

/** Required text: exact string type, trimmed, non-empty, bounded, no raw angle brackets. */
function requiredText(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= max && !/[<>]/.test(trimmed) ? trimmed : null;
}

/** Optional text: absent/null/empty/whitespace-only all become null; otherwise bounded, no raw angle brackets. */
function optionalText(value: unknown, max: number): string | null | undefined {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (trimmed === '') return null;
  return trimmed.length <= max && !/[<>]/.test(trimmed) ? trimmed : undefined;
}

function requiredEmail(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  // Lowercase is the approved public-facing email convention (matches
  // src/auth/emailNormalization.ts); it only normalizes for storage/lookup,
  // it never changes what the address actually is.
  const normalized = value.trim().toLowerCase();
  return normalized.length > 0 && normalized.length <= MAX_PUBLIC_EMAIL && EMAIL_PATTERN.test(normalized) ? normalized : null;
}

export function parsePublicSupportIntakePayload(value: unknown): ValidationResult<PublicSupportIntakeInput> {
  const input = asObject(value);
  if (!input) return { ok: false, error: 'invalid_payload' };
  if (!hasOnlyAllowedKeys(input, ALLOWED_KEYS)) return { ok: false, error: 'unknown_field' };

  // Honeypot first, before validating anything else: a filled formGuard
  // field means this is a bot, and from here the caller must behave exactly
  // as if everything were valid (fake success, no RPC call) regardless of
  // what garbage the rest of the payload contains. The field name is
  // deliberately non-semantic (FASE 7D.1-E, replacing the old "company"
  // name): a name that resembles a real form field invites browser/password-
  // manager autofill to silently fill it from a real visitor's own saved
  // data, which is then misread as a bot -- never rename it to something
  // that could match an autofill heuristic.
  if (typeof input.formGuard !== 'undefined' && input.formGuard !== null && input.formGuard !== '') {
    if (typeof input.formGuard !== 'string') return { ok: false, error: 'invalid_payload' };
    if (input.formGuard.trim() !== '') {
      return {
        ok: true,
        value: {
          customerName: '', customerEmail: '', customerPhone: null, topic: 'general', subject: null, orderReference: null, message: '',
          honeypotTriggered: true,
        },
      };
    }
  }

  const customerName = requiredText(input.customerName, MAX_PUBLIC_NAME);
  if (!customerName) return { ok: false, error: 'invalid_customer_name' };

  const customerEmail = requiredEmail(input.customerEmail);
  if (!customerEmail) return { ok: false, error: 'invalid_customer_email' };

  const customerPhone = optionalText(input.customerPhone, MAX_PUBLIC_PHONE);
  if (customerPhone === undefined) return { ok: false, error: 'invalid_customer_phone' };

  if (typeof input.topic !== 'string' || !SUPPORT_TOPICS.includes(input.topic as SupportTopic)) {
    return { ok: false, error: 'invalid_topic' };
  }
  const topic = input.topic as SupportTopic;

  const subject = optionalText(input.subject, MAX_PUBLIC_SUBJECT);
  if (subject === undefined) return { ok: false, error: 'invalid_subject' };

  const orderReference = optionalText(input.orderReference, MAX_PUBLIC_ORDER_REFERENCE);
  if (orderReference === undefined) return { ok: false, error: 'invalid_order_reference' };

  const message = requiredText(input.message, MAX_PUBLIC_MESSAGE);
  if (!message) return { ok: false, error: 'invalid_message' };

  return {
    ok: true,
    value: { customerName, customerEmail, customerPhone, topic, subject, orderReference, message, honeypotTriggered: false },
  };
}
