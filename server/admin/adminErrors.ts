// Maps the custom SQLSTATEs raised by the ADMIN-01B/ADMIN-01C RPCs
// (supabase/migrations/202609230201_admin_01b_admin_boundary.sql and
// 202609230301_admin_01c_secure_media.sql) to sanitized HTTP responses. Never
// forwards the raw Postgres message, hint or detail: the SQLSTATE alone
// tells the caller everything it is allowed to know.

const RESPONSE_BY_CODE: Record<string, { status: number; error: string }> = {
  ADM01: { status: 401, error: 'No autorizado.' },
  ADM03: { status: 403, error: 'No autorizado.' },
  ADM04: { status: 404, error: 'No encontrado.' },
  ADM09: { status: 409, error: 'El recurso fue modificado en otra sesion. Recarga los datos antes de guardar.' },
  ADM10: { status: 409, error: 'La autorizacion de carga vencio. Volve a intentar la carga de la imagen.' },
  ADM22: { status: 422, error: 'Solicitud invalida.' },
};

export function mapAdminRpcError(error: { code?: string | null } | null | undefined): { status: number; error: string } {
  const mapped = error?.code ? RESPONSE_BY_CODE[error.code] : undefined;
  return mapped ?? { status: 500, error: 'No disponible.' };
}
