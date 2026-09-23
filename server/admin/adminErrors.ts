// Maps the custom SQLSTATEs raised by the ADMIN-01B RPCs
// (supabase/migrations/202609230201_admin_01b_admin_boundary.sql) to sanitized
// HTTP responses. Never forwards the raw Postgres message, hint or detail: the
// SQLSTATE alone tells the caller everything it is allowed to know.

const STATUS_BY_CODE: Record<string, number> = {
  ADM01: 401,
  ADM03: 403,
  ADM04: 404,
  ADM09: 409,
  ADM22: 422,
};

const MESSAGE_BY_STATUS: Record<number, string> = {
  401: 'No autorizado.',
  403: 'No autorizado.',
  404: 'No encontrado.',
  409: 'El recurso fue modificado en otra sesion. Recarga los datos antes de guardar.',
  422: 'Solicitud invalida.',
};

export function mapAdminRpcError(error: { code?: string | null } | null | undefined): { status: number; error: string } {
  const status = error?.code ? STATUS_BY_CODE[error.code] : undefined;
  if (status) return { status, error: MESSAGE_BY_STATUS[status] };
  return { status: 500, error: 'No disponible.' };
}
