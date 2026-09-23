import { mapAdminRpcError } from '../../../server/admin/adminErrors.js';
import { defaultRequireAdminDependencies, requireAdmin, type RequireAdminDependencies } from '../../../server/admin/requireAdmin.js';
import { mapAdminProductRow, type AdminProductRow } from '../../../server/admin/serialize.js';
import { isValid, parseSetActiveProductPayload } from '../../../server/admin/validators.js';
import { applyAdminCors, logEvent, type ApiRequest, type ApiResponse } from '../../../server/commerce/commerce.js';

export const config = { api: { bodyParser: false } };

export default createAdminSetProductActiveHandler();

export function createAdminSetProductActiveHandler(overrides: Partial<RequireAdminDependencies> = {}) {
  const dependencies: RequireAdminDependencies = { ...defaultRequireAdminDependencies, ...overrides };

  return async function handler(request: ApiRequest, response: ApiResponse) {
    if (request.method === 'OPTIONS') {
      if (!applyAdminCors(request, response)) return response.status(403).json({ error: 'No autorizado.' });
      return response.status(204).end?.();
    }

    const auth = await requireAdmin(request, response, dependencies);
    if (auth.kind === 'error') return response.status(auth.status).json({ error: auth.error });

    const payload = parseSetActiveProductPayload(auth.body);
    if (!isValid(payload)) return response.status(422).json({ error: 'Solicitud invalida.', requestId: auth.requestId });

    const { data, error } = await auth.rpc.rpc('admin_set_product_active', {
      p_product_id: payload.value.id,
      p_is_active: payload.value.isActive,
      p_expected_updated_at: payload.value.expectedUpdatedAt,
      p_request_id: auth.requestId,
    });

    if (error || !data) {
      const mapped = mapAdminRpcError(error);
      logEvent('admin_product_set_active_failed', { status: mapped.status });
      return response.status(mapped.status).json({ error: mapped.error, requestId: auth.requestId });
    }

    logEvent(payload.value.isActive ? 'admin_product_activated' : 'admin_product_deactivated');
    return response.status(200).json({ product: mapAdminProductRow(data as AdminProductRow), requestId: auth.requestId });
  };
}
