// Maps the custom SQLSTATEs raised by public_create_support_request
// (supabase/migrations/202610080101_admin_03b_public_support_intake.sql) to
// sanitized HTTP responses. Never forwards the raw Postgres message, hint or
// detail (beyond the rate-limit retry window, read separately by the
// caller) -- the SQLSTATE alone tells the caller everything it is allowed
// to know.

const RESPONSE_BY_CODE: Record<string, { status: number; error: string }> = {
  ADM22: { status: 400, error: 'Solicitud invalida.' },
  ADM29: { status: 429, error: 'Demasiadas solicitudes.' },
};

export function mapPublicSupportRpcError(error: { code?: string | null } | null | undefined): { status: number; error: string } {
  const mapped = error?.code ? RESPONSE_BY_CODE[error.code] : undefined;
  return mapped ?? { status: 500, error: 'No disponible.' };
}
