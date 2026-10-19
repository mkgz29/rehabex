// Validation for the anonymous withdrawal-request endpoint. This surface is
// intentionally narrower than the general support form: it accepts only the
// minimum data needed to identify the buyer and the purchase, plus optional
// contact context. It never accepts order ids, payment data or admin fields.

export type ValidationResult<T> = { ok: true; value: T } | { ok: false; error: string };

const MAX_NAME = 160;
const MAX_EMAIL = 254;
const MAX_PHONE = 40;
const MAX_ORDER_REFERENCE = 60;
const MAX_MESSAGE = 2000;
const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

const ALLOWED_KEYS = ['customerName', 'customerEmail', 'customerPhone', 'orderReference', 'message', 'formGuard'] as const;

export type PublicWithdrawalInput = {
  customerName: string;
  customerEmail: string;
  customerPhone: string | null;
  orderReference: string;
  message: string | null;
  honeypotTriggered: boolean;
};

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function hasOnlyAllowedKeys(input: Record<string, unknown>) {
  return !Object.keys(input).some((key) => !ALLOWED_KEYS.includes(key as (typeof ALLOWED_KEYS)[number]));
}

function requiredText(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= max && !/[<>]/.test(trimmed) ? trimmed : null;
}

function optionalText(value: unknown, max: number): string | null | undefined {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.length <= max && !/[<>]/.test(trimmed) ? trimmed : undefined;
}

export function parsePublicWithdrawalPayload(value: unknown): ValidationResult<PublicWithdrawalInput> {
  const input = asObject(value);
  if (!input || !hasOnlyAllowedKeys(input)) return { ok: false, error: 'invalid_payload' };

  if (typeof input.formGuard !== 'undefined' && input.formGuard !== null && input.formGuard !== '') {
    if (typeof input.formGuard !== 'string') return { ok: false, error: 'invalid_payload' };
    if (input.formGuard.trim()) {
      return {
        ok: true,
        value: { customerName: '', customerEmail: '', customerPhone: null, orderReference: '', message: null, honeypotTriggered: true },
      };
    }
  }

  const customerName = requiredText(input.customerName, MAX_NAME);
  if (!customerName) return { ok: false, error: 'invalid_customer_name' };

  const rawEmail = typeof input.customerEmail === 'string' ? input.customerEmail.trim().toLowerCase() : '';
  if (!rawEmail || rawEmail.length > MAX_EMAIL || !EMAIL_PATTERN.test(rawEmail)) {
    return { ok: false, error: 'invalid_customer_email' };
  }

  const orderReference = requiredText(input.orderReference, MAX_ORDER_REFERENCE);
  if (!orderReference) return { ok: false, error: 'invalid_order_reference' };

  const customerPhone = optionalText(input.customerPhone, MAX_PHONE);
  if (customerPhone === undefined) return { ok: false, error: 'invalid_customer_phone' };

  const message = optionalText(input.message, MAX_MESSAGE);
  if (message === undefined) return { ok: false, error: 'invalid_message' };

  return {
    ok: true,
    value: {
      customerName,
      customerEmail: rawEmail,
      customerPhone,
      orderReference,
      message,
      honeypotTriggered: false,
    },
  };
}
