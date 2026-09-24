// Handler logic for the admin products routes. Lives outside api/ so it
// counts as zero Vercel Serverless Functions on its own; api/admin/[...path].ts
// is the single function that dispatches to these by path.
import { mapAdminRpcError } from '../adminErrors.js';
import { defaultRequireAdminDependencies, requireAdmin, type RequireAdminDependencies } from '../requireAdmin.js';
import { mapAdminProductRow, type AdminProductRow } from '../serialize.js';
import { isValid, parseCreateProductPayload, parseSetActiveProductPayload, parseUpdateProductPayload } from '../validators.js';
import { applyAdminCors, logEvent, type ApiRequest, type ApiResponse } from '../../commerce/commerce.js';

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

    const { data, error } = await auth.rpc.rpc('admin_create_product_with_media', {
      p_name: payload.value.name,
      p_description: payload.value.description,
      p_category: payload.value.category,
      p_price: payload.value.price,
      p_image_url: payload.value.imageUrl,
      p_image_asset_id: payload.value.imageAssetId,
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

export function createAdminUpdateProductHandler(overrides: Partial<RequireAdminDependencies> = {}) {
  const dependencies: RequireAdminDependencies = { ...defaultRequireAdminDependencies, ...overrides };

  return async function handler(request: ApiRequest, response: ApiResponse) {
    if (request.method === 'OPTIONS') {
      if (!applyAdminCors(request, response)) return response.status(403).json({ error: 'No autorizado.' });
      return response.status(204).end?.();
    }

    const auth = await requireAdmin(request, response, dependencies);
    if (auth.kind === 'error') return response.status(auth.status).json({ error: auth.error });

    const payload = parseUpdateProductPayload(auth.body);
    if (!isValid(payload)) return response.status(422).json({ error: 'Solicitud invalida.', requestId: auth.requestId });

    const { data, error } = await auth.rpc.rpc('admin_update_product_with_media', {
      p_product_id: payload.value.id,
      p_name: payload.value.name,
      p_description: payload.value.description,
      p_category: payload.value.category,
      p_price: payload.value.price,
      p_image_url: payload.value.imageUrl,
      p_image_asset_id: payload.value.imageAssetId,
      p_is_featured: payload.value.isFeatured,
      p_display_order: payload.value.displayOrder,
      p_expected_updated_at: payload.value.expectedUpdatedAt,
      p_request_id: auth.requestId,
    });

    if (error || !data) {
      const mapped = mapAdminRpcError(error);
      logEvent('admin_product_update_failed', { status: mapped.status });
      return response.status(mapped.status).json({ error: mapped.error, requestId: auth.requestId });
    }

    logEvent('admin_product_updated');
    return response.status(200).json({ product: mapAdminProductRow(data as AdminProductRow), requestId: auth.requestId });
  };
}

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
