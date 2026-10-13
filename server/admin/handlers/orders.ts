// Handler logic for the admin Orders fulfillment route (FASE 7F-B4). Lives
// outside api/ so it adds zero Vercel Serverless Functions on its own --
// api/admin/[category]/[action].ts is the single function that dispatches
// to this by path, same as products/settings/media/support.
import { mapAdminRpcError } from '../adminErrors.js';
import { defaultRequireAdminDependencies, requireAdmin, type RequireAdminDependencies } from '../requireAdmin.js';
import { isValid, parseUpdateOrderFulfillmentStatusPayload } from '../validators.js';
import { applyAdminCors, logEvent, type ApiRequest, type ApiResponse } from '../../commerce/commerce.js';

export function createAdminUpdateOrderFulfillmentStatusHandler(overrides: Partial<RequireAdminDependencies> = {}) {
  const dependencies: RequireAdminDependencies = { ...defaultRequireAdminDependencies, ...overrides };

  return async function handler(request: ApiRequest, response: ApiResponse) {
    if (request.method === 'OPTIONS') {
      if (!applyAdminCors(request, response)) return response.status(403).json({ error: 'No autorizado.' });
      return response.status(204).end?.();
    }

    const auth = await requireAdmin(request, response, dependencies);
    if (auth.kind === 'error') return response.status(auth.status).json({ error: auth.error });

    const payload = parseUpdateOrderFulfillmentStatusPayload(auth.body);
    if (!isValid(payload)) return response.status(422).json({ error: 'Solicitud invalida.', requestId: auth.requestId });

    const { data, error } = await auth.rpc.rpc('admin_update_order_fulfillment_status', {
      p_order_id: payload.value.id,
      p_to_status: payload.value.toStatus,
      p_note: payload.value.note,
      p_request_id: auth.requestId,
    });

    if (error || !data) {
      const mapped = mapAdminRpcError(error);
      logEvent('admin_order_fulfillment_update_failed', { status: mapped.status });
      return response.status(mapped.status).json({ error: mapped.error, requestId: auth.requestId });
    }

    logEvent('admin_order_fulfillment_updated');
    return response.status(200).json({ order: data, requestId: auth.requestId });
  };
}
