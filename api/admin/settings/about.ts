import { mapAdminRpcError } from '../../../server/admin/adminErrors.js';
import { defaultRequireAdminDependencies, requireAdmin, type RequireAdminDependencies } from '../../../server/admin/requireAdmin.js';
import { mapAdminSettingsRow, type AdminSettingsRow } from '../../../server/admin/serialize.js';
import { isValid, parseAboutContentPayload } from '../../../server/admin/validators.js';
import { applyAdminCors, logEvent, type ApiRequest, type ApiResponse } from '../../../server/commerce/commerce.js';

export const config = { api: { bodyParser: false } };

export default createAdminAboutSettingsHandler();

export function createAdminAboutSettingsHandler(overrides: Partial<RequireAdminDependencies> = {}) {
  const dependencies: RequireAdminDependencies = { ...defaultRequireAdminDependencies, ...overrides };

  return async function handler(request: ApiRequest, response: ApiResponse) {
    if (request.method === 'OPTIONS') {
      if (!applyAdminCors(request, response)) return response.status(403).json({ error: 'No autorizado.' });
      return response.status(204).end?.();
    }

    const auth = await requireAdmin(request, response, dependencies);
    if (auth.kind === 'error') return response.status(auth.status).json({ error: auth.error });

    const payload = parseAboutContentPayload(auth.body);
    if (!isValid(payload)) return response.status(422).json({ error: 'Solicitud invalida.', requestId: auth.requestId });

    // The client never chooses the settings key; this endpoint always writes about_content.
    const { data, error } = await auth.rpc.rpc('admin_upsert_settings_document_with_media', {
      p_key: 'about_content',
      p_value: payload.value.content,
      p_image_asset_id: payload.value.imageAssetId,
      p_expected_updated_at: payload.value.expectedUpdatedAt,
      p_request_id: auth.requestId,
    });

    if (error || !data) {
      const mapped = mapAdminRpcError(error);
      logEvent('admin_about_update_failed', { status: mapped.status });
      return response.status(mapped.status).json({ error: mapped.error, requestId: auth.requestId });
    }

    logEvent('admin_about_updated');
    return response.status(200).json({ setting: mapAdminSettingsRow(data as AdminSettingsRow), requestId: auth.requestId });
  };
}
