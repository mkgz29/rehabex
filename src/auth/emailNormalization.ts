// Email only. Passwords must never pass through trim/lowercase/any
// transformation -- see signIn/signUp in AuthProvider.tsx, which forward the
// password exactly as typed.
export const EMAIL_MAX_LENGTH = 254;

const EMAIL_FORMAT_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeEmail(rawEmail: string): string {
  return rawEmail.trim().toLowerCase();
}

export function isValidEmailFormat(email: string): boolean {
  return email.length > 0 && email.length <= EMAIL_MAX_LENGTH && EMAIL_FORMAT_PATTERN.test(email);
}
