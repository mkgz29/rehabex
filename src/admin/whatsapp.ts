// Assisted WhatsApp contact core (FASE 7D-A). Pure logic only: no fetch, no
// Supabase, no window access, no side effects. The admin always decides
// whether to actually send anything -- this module only ever builds a
// wa.me link and a prefilled, editable message; nothing here opens a tab,
// calls an API, or writes to any store.

const DEFAULT_BRAND_NAME = 'Rehabex';

/**
 * Structural E.164 plausibility only -- digits only, 8-15 digits long (the
 * standard's own maximum), first digit not "0" (no real country code
 * starts with 0). Does not validate that the country code or operator
 * prefix actually exists; it only rejects shapes that could never be a
 * real E.164 number.
 */
function isPlausibleE164(digits: string): boolean {
  return /^[1-9]\d{7,14}$/.test(digits);
}

/**
 * Converts a phone number as a customer or admin would type it into the
 * digit-only string wa.me expects (country code + number, no "+"). Returns
 * null whenever the input is ambiguous -- this never guesses a missing
 * country code or a missing mobile "9".
 *
 * Supported, unambiguous cases only:
 *  - Explicit "+" international: every non-digit character is stripped and
 *    the digits are used as-is, whatever the country code. The original
 *    structure is never altered (no "9" is ever inserted here).
 *    Examples: "+54 9 381 555 1234" -> "5493815551234", "+54 381 5551234"
 *    -> "543815551234" (kept exactly as given), "+1 202 555 0100" ->
 *    "12025550100".
 *  - Already international without the "+", written as a bare digit
 *    string (no spaces/separators) starting with "54" at a plausible
 *    Argentine length (12 or 13 digits): used as-is.
 *    Example: "5493815551234" -> "5493815551234".
 *  - Argentina's standard local mobile dialing format, "0<area> 15
 *    <number>" (trunk prefix + area code + the "15" mobile marker + local
 *    number): rewritten to "54 9 <area> <number>", since "15" is an
 *    explicit, unambiguous signal that this is a mobile number.
 *    Example: "0381 15 5551234" -> "5493815551234".
 *
 * Deliberately rejected as ambiguous or invalid, never guessed:
 *  - A bare "<area> <number>" with no leading "0", no "15" marker and no
 *    "+" (e.g. "381 5551234"): no reliable signal for whether this is
 *    mobile (needs "9") or landline, or even what the area code is.
 *  - "0<area> <number>" without the "15" marker (e.g. "0381 5551234"):
 *    same ambiguity, the trunk prefix alone does not imply mobile.
 *  - Empty/whitespace-only input, non-numeric input, or anything that does
 *    not reduce to a plausible 8-15 digit number.
 */
export function normalizePhoneForWhatsApp(input: string): string | null {
  if (typeof input !== 'string') return null;
  const trimmed = input.trim();
  if (trimmed === '') return null;

  if (trimmed.startsWith('+')) {
    const digits = trimmed.slice(1).replace(/\D/g, '');
    return isPlausibleE164(digits) ? digits : null;
  }

  // Argentina local mobile dialing format: 0<area> 15 <number>. Matched on
  // a lightly-cleaned string (dashes/parens/dots collapsed to spaces, runs
  // of whitespace collapsed to one) so "15" has to appear as its own
  // token -- never as a coincidental substring of a longer digit run.
  const lightlyCleaned = trimmed.replace(/[-().]/g, ' ').replace(/\s+/g, ' ').trim();
  const localMobileMatch = /^0(\d{2,4}) 15 (\d{6,8})$/.exec(lightlyCleaned);
  if (localMobileMatch) {
    const [, area, number] = localMobileMatch;
    const digits = `549${area}${number}`;
    return isPlausibleE164(digits) ? digits : null;
  }

  // Bare international digits with no "+" and no separators: only
  // accepted for Argentina's own country code, at the lengths a real
  // Argentine number produces, to avoid misreading an unrelated bare
  // digit string as international.
  const digitsOnly = trimmed.replace(/\D/g, '');
  if (digitsOnly.length === trimmed.length && digitsOnly.startsWith('54') && (digitsOnly.length === 12 || digitsOnly.length === 13)) {
    return digitsOnly;
  }

  return null;
}

/**
 * https://wa.me/{digits}?text={message}, built with URLSearchParams so the
 * message is always correctly encoded and can never inject an extra query
 * parameter. Normalizes `phone` internally; returns null (no link) when it
 * does not normalize, so a caller never gets a broken wa.me URL.
 */
export function buildWhatsAppUrl(phone: string, message: string): string | null {
  const digits = normalizePhoneForWhatsApp(phone);
  if (!digits) return null;
  const url = new URL(`https://wa.me/${digits}`);
  url.searchParams.set('text', message);
  return url.toString();
}

/**
 * The only approved Soporte template. Never includes email, UUID,
 * internal_notes, status or the raw topic -- those are not parameters, so
 * there is nothing for this function to leak.
 */
export function buildSupportWhatsAppMessage(customerName: string, orderReference?: string | null, brandName: string = DEFAULT_BRAND_NAME): string {
  const name = customerName.trim();
  const reference = orderReference?.trim();
  if (reference) {
    return `Hola ${name}, somos de ${brandName}. Te contactamos por tu consulta sobre el pedido ${reference}.`;
  }
  return `Hola ${name}, somos de ${brandName}. Te contactamos por tu consulta.`;
}

/**
 * The only approved Pedidos template. `orderReference` must be a
 * human-friendly reference (e.g. order_number) -- this function does not
 * validate that, so callers must never pass the raw order UUID.
 */
export function buildOrderWhatsAppMessage(customerName: string, orderReference: string, brandName: string = DEFAULT_BRAND_NAME): string {
  const name = customerName.trim();
  const reference = orderReference.trim();
  return `Hola ${name}, somos de ${brandName}. Te contactamos por tu pedido ${reference}.`;
}
