// Handler logic for the admin Hero/About settings routes. Lives outside
// api/ so it counts as zero Vercel Serverless Functions on its own;
// api/admin/[...path].ts is the single function that dispatches by path.
import { mapAdminRpcError } from '../adminErrors.js';
import { defaultRequireAdminDependencies, requireAdmin, type RequireAdminDependencies } from '../requireAdmin.js';
import { mapAdminSettingsRow, type AdminSettingsRow } from '../serialize.js';
import {
  isValid,
  parseAboutContentPayload,
  parseCatalogSectionContentPayload,
  parseFeaturedSectionContentPayload,
  parseHeroContentPayload,
} from '../validators.js';
import { applyAdminCors, logEvent, type ApiRequest, type ApiResponse } from '../../commerce/commerce.js';

export function createAdminHeroSettingsHandler(overrides: Partial<RequireAdminDependencies> = {}) {
  const dependencies: RequireAdminDependencies = { ...defaultRequireAdminDependencies, ...overrides };

  return async function handler(request: ApiRequest, response: ApiResponse) {
    if (request.method === 'OPTIONS') {
      if (!applyAdminCors(request, response)) return response.status(403).json({ error: 'No autorizado.' });
      return response.status(204).end?.();
    }

    const auth = await requireAdmin(request, response, dependencies);
    if (auth.kind === 'error') return response.status(auth.status).json({ error: auth.error });

    const payload = parseHeroContentPayload(auth.body);
    if (!isValid(payload)) return response.status(422).json({ error: 'Solicitud invalida.', requestId: auth.requestId });

    // The client never chooses the settings key; this endpoint always writes hero_content.
    const { data, error } = await auth.rpc.rpc('admin_upsert_settings_document_with_media', {
      p_key: 'hero_content',
      p_value: payload.value.content,
      p_image_asset_id: payload.value.imageAssetId,
      p_expected_updated_at: payload.value.expectedUpdatedAt,
      p_request_id: auth.requestId,
    });

    if (error || !data) {
      const mapped = mapAdminRpcError(error);
      logEvent('admin_hero_update_failed', { status: mapped.status });
      return response.status(mapped.status).json({ error: mapped.error, requestId: auth.requestId });
    }

    logEvent('admin_hero_updated');
    return response.status(200).json({ setting: mapAdminSettingsRow(data as AdminSettingsRow), requestId: auth.requestId });
  };
}

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

// The two ADMIN-02E editorial-copy endpoints below have no image, so they go
// straight through the plain (non-media) admin_upsert_settings_document RPC.

export function createAdminFeaturedSectionSettingsHandler(overrides: Partial<RequireAdminDependencies> = {}) {
  const dependencies: RequireAdminDependencies = { ...defaultRequireAdminDependencies, ...overrides };

  return async function handler(request: ApiRequest, response: ApiResponse) {
    if (request.method === 'OPTIONS') {
      if (!applyAdminCors(request, response)) return response.status(403).json({ error: 'No autorizado.' });
      return response.status(204).end?.();
    }

    const auth = await requireAdmin(request, response, dependencies);
    if (auth.kind === 'error') return response.status(auth.status).json({ error: auth.error });

    const payload = parseFeaturedSectionContentPayload(auth.body);
    if (!isValid(payload)) return response.status(422).json({ error: 'Solicitud invalida.', requestId: auth.requestId });

    const { data, error } = await auth.rpc.rpc('admin_upsert_settings_document', {
      p_key: 'featured_section_content',
      p_value: payload.value.content,
      p_expected_updated_at: payload.value.expectedUpdatedAt,
      p_request_id: auth.requestId,
    });

    if (error || !data) {
      const mapped = mapAdminRpcError(error);
      logEvent('admin_featured_section_update_failed', { status: mapped.status });
      return response.status(mapped.status).json({ error: mapped.error, requestId: auth.requestId });
    }

    logEvent('admin_featured_section_updated');
    return response.status(200).json({ setting: mapAdminSettingsRow(data as AdminSettingsRow), requestId: auth.requestId });
  };
}

export function createAdminCatalogSectionSettingsHandler(overrides: Partial<RequireAdminDependencies> = {}) {
  const dependencies: RequireAdminDependencies = { ...defaultRequireAdminDependencies, ...overrides };

  return async function handler(request: ApiRequest, response: ApiResponse) {
    if (request.method === 'OPTIONS') {
      if (!applyAdminCors(request, response)) return response.status(403).json({ error: 'No autorizado.' });
      return response.status(204).end?.();
    }

    const auth = await requireAdmin(request, response, dependencies);
    if (auth.kind === 'error') return response.status(auth.status).json({ error: auth.error });

    const payload = parseCatalogSectionContentPayload(auth.body);
    if (!isValid(payload)) return response.status(422).json({ error: 'Solicitud invalida.', requestId: auth.requestId });

    const { data, error } = await auth.rpc.rpc('admin_upsert_settings_document', {
      p_key: 'catalog_section_content',
      p_value: payload.value.content,
      p_expected_updated_at: payload.value.expectedUpdatedAt,
      p_request_id: auth.requestId,
    });

    if (error || !data) {
      const mapped = mapAdminRpcError(error);
      logEvent('admin_catalog_section_update_failed', { status: mapped.status });
      return response.status(mapped.status).json({ error: mapped.error, requestId: auth.requestId });
    }

    logEvent('admin_catalog_section_updated');
    return response.status(200).json({ setting: mapAdminSettingsRow(data as AdminSettingsRow), requestId: auth.requestId });
  };
}
