// Assisted WhatsApp contact (FASE 7D). No Business API, no Meta SDK, no
// automatic sending: this only ever builds a wa.me link the admin opens by
// hand. Pure and framework-agnostic on purpose, so Pedidos' "Contactar"
// action reuses normalizePhoneForWhatsApp/buildWhatsAppUrl unchanged.

export type PhoneNormalizationResult = { ok: true; digits: string } | { ok: false };

/**
 * Structural E.164 plausibility only -- digits only, 8-15 digits long (the
 * standard's own maximum), and the first digit not "0" (no real country
 * code starts with 0). This does not validate that the country code or
 * operator prefix actually exists; it only rejects shapes that could never
 * be a real E.164 number.
 */
function isPlausibleE164(digits: string): boolean {
  return /^[1-9]\d{7,14}$/.test(digits);
}

/**
 * Converts a phone number as a customer or admin would type it into the
 * digit-only string wa.me expects (country code + number, no "+"). The
 * original value is never touched by this function -- callers keep
 * customer_phone exactly as stored and only use the return value for the
 * link.
 *
 * Supported, unambiguous cases only (see whatsapp.test.ts for the exact
 * fixtures):
 *  - Already international with a leading "+": every non-digit character is
 *    stripped and the digits are used as-is, whatever the country code.
 *    Examples: "+54 9 381 555 1234", "+54 381 5551234", "+1 202 555 0100".
 *  - Already international without the "+" but written as a bare digit
 *    string starting with "54" at a plausible Argentine length (12 or 13
 *    digits): used as-is. Example: "5493815551234".
 *  - Argentina's standard local mobile dialing format, "0<area> 15
 *    <number>" (trunk prefix + area code + the "15" mobile marker + local
 *    number), with the area code and number as separate tokens: rewritten
 *    to "54 9 <area> <number>". Example: "0381 15 5551234".
 *
 * Deliberately rejected as ambiguous or invalid, never guessed:
 *  - A bare "<area> <number>" with no leading "0", no "15" marker and no
 *    "+" (e.g. "381 5551234"): there is no reliable signal here for
 *    whether this is a mobile number (which needs the "9") or a landline,
 *    so inserting a "9" would be inventing a digit that was not given.
 *  - Empty/whitespace-only input.
 *  - Anything that does not reduce to a plausible 8-15 digit number.
 */
export function normalizePhoneForWhatsApp(input: string): PhoneNormalizationResult {
  if (typeof input !== 'string') return { ok: false };
  const trimmed = input.trim();
  if (trimmed === '') return { ok: false };

  if (trimmed.startsWith('+')) {
    const digits = trimmed.slice(1).replace(/\D/g, '');
    return isPlausibleE164(digits) ? { ok: true, digits } : { ok: false };
  }

  // Argentina local mobile dialing format: 0<area> 15 <number>. Matched on
  // a lightly-cleaned string (dashes/parens/dots collapsed to spaces, runs
  // of whitespace collapsed to one) so the "15" has to appear as its own
  // token -- never as a coincidental substring of a longer digit run.
  const lightlyCleaned = trimmed.replace(/[-().]/g, ' ').replace(/\s+/g, ' ').trim();
  const localMobileMatch = /^0(\d{2,4}) 15 (\d{6,8})$/.exec(lightlyCleaned);
  if (localMobileMatch) {
    const [, area, number] = localMobileMatch;
    const digits = `549${area}${number}`;
    return isPlausibleE164(digits) ? { ok: true, digits } : { ok: false };
  }

  const digitsOnly = trimmed.replace(/\D/g, '');
  if (digitsOnly.length === trimmed.length && digitsOnly.startsWith('54') && (digitsOnly.length === 12 || digitsOnly.length === 13)) {
    return { ok: true, digits: digitsOnly };
  }

  return { ok: false };
}

/** https://wa.me/{digits}?text={message}, with the message correctly encoded via URLSearchParams -- never string-concatenated, so it cannot inject extra query parameters. */
export function buildWhatsAppUrl(digits: string, message: string): string {
  const url = new URL(`https://wa.me/${digits}`);
  url.searchParams.set('text', message);
  return url.toString();
}

/**
 * The only two approved templates for an admin-initiated WhatsApp contact
 * (used by both Soporte and Pedidos). Never includes email, address,
 * internal status, internal notes, or a payment id -- only what the
 * approved spec lists.
 */
export function buildWhatsAppMessage(customerName: string, orderNumber?: string | null): string {
  const name = customerName.trim();
  const trimmedOrderNumber = orderNumber?.trim();
  if (trimmedOrderNumber) {
    return `Hola ${name}, somos Rehabex. Te escribimos por tu pedido ${trimmedOrderNumber}.`;
  }
  return `Hola ${name}, somos Rehabex. Te escribimos por tu consulta.`;
}
