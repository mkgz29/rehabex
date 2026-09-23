import { mapAdminRpcError } from '../../../server/admin/adminErrors.js';
import { defaultRequireAdminDependencies, requireAdmin, type RequireAdminDependencies } from '../../../server/admin/requireAdmin.js';
import { mapAdminProductRow, type AdminProductRow } from '../../../server/admin/serialize.js';
import { isValid, parseCreateProductPayload } from '../../../server/admin/validators.js';
import { applyAdminCors, logEvent, type ApiRequest, type ApiResponse } from '../../../server/commerce/commerce.js';

export const config = { api: { bodyParser: false } };

export default createAdminCreateProductHandler();

export function createAdminCreateProductHandler(overrides: Partial<RequireAdminDependencies> = {}) {
  const dependencies: RequireAdminDependencies = { ...defaultRequireAdminDependencies, ...overrides };

  return async function handler(request: ApiRequest, response: ApiResponse) {
    if (request.method === 'OPTIONS') {
      if (!applyAdminCors(request, response)) return response.status(403).json({ error: 'No autorizado.' });
      return response.status(204).end?.();
    }

    const auth = await requireAdmin(request, response, dependencies);
    if (auth.kind === 'error') return response.status(auth.status).json({ error: auth.error });

    const payload = parseCreateProductPayload(auth.body);
    if (!isValid(payload)) return response.status(422).json({ error: 'Solicitud invalida.', requestId: auth.requestId });

    const { data, error } = await auth.rpc.rpc('admin_create_product', {
      p_name: payload.value.name,
      p_description: payload.value.description,
      p_category: payload.value.category,
      p_price: payload.value.price,
      p_image_url: payload.value.imageUrl,
      p_is_featured: payload.value.isFeatured,
      p_display_order: payload.value.displayOrder,
      p_request_id: auth.requestId,
    });

    if (error || !data) {
      const mapped = mapAdminRpcError(error);
      logEvent('admin_product_create_failed', { status: mapped.status });
      return response.status(mapped.status).json({ error: mapped.error, requestId: auth.requestId });
    }

    logEvent('admin_product_created');
    return response.status(200).json({ product: mapAdminProductRow(data as AdminProductRow), requestId: auth.requestId });
  };
}
