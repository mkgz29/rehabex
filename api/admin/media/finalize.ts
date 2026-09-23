import { mapAdminRpcError } from '../../../server/admin/adminErrors.js';
import {
  cloudinaryEnv,
  destroyAsset,
  fetchResourceMetadata,
  isCloudinarySecureUrl,
  verifyUploadSignature,
  type CloudinaryEnv,
} from '../../../server/admin/cloudinaryClient.js';
import { isValid, mimeTypeForFormat, parseMediaFinalizePayload, validateResourceMetadata } from '../../../server/admin/mediaValidators.js';
import { defaultRequireAdminDependencies, requireAdmin, type RequireAdminDependencies } from '../../../server/admin/requireAdmin.js';
import { applyAdminCors, logEvent, type ApiRequest, type ApiResponse } from '../../../server/commerce/commerce.js';

export const config = { api: { bodyParser: false } };

export type FinalizeDependencies = RequireAdminDependencies & {
  cloudinaryEnv: () => CloudinaryEnv | null;
  verifyUploadSignature: (env: CloudinaryEnv, publicId: string, version: number, signature: string) => boolean;
  fetchResourceMetadata: (env: CloudinaryEnv, publicId: string) => Promise<Record<string, unknown> | null>;
  destroyAsset: (env: CloudinaryEnv, publicId: string) => Promise<{ ok: boolean }>;
};

const defaultFinalizeDependencies: FinalizeDependencies = {
  ...defaultRequireAdminDependencies,
  cloudinaryEnv,
  verifyUploadSignature,
  fetchResourceMetadata,
  destroyAsset,
};

export default createAdminMediaFinalizeHandler();

export function createAdminMediaFinalizeHandler(overrides: Partial<FinalizeDependencies> = {}) {
  const dependencies: FinalizeDependencies = { ...defaultFinalizeDependencies, ...overrides };

  return async function handler(request: ApiRequest, response: ApiResponse) {
    if (request.method === 'OPTIONS') {
      if (!applyAdminCors(request, response)) return response.status(403).json({ error: 'No autorizado.' });
      return response.status(204).end?.();
    }

    const auth = await requireAdmin(request, response, dependencies);
    if (auth.kind === 'error') return response.status(auth.status).json({ error: auth.error });

    const payload = parseMediaFinalizePayload(auth.body);
    if (!isValid(payload)) return response.status(422).json({ error: 'Solicitud invalida.', requestId: auth.requestId });

    const env = dependencies.cloudinaryEnv();
    if (!env) {
      logEvent('admin_media_finalize_not_configured');
      return response.status(503).json({ error: 'No disponible.' });
    }

    const { publicId, version, signature } = payload.value;

    // The browser is never trusted for format/size/dimensions: only for
    // *which* upload it means. Cloudinary's own signature over exactly
    // public_id+version is what proves this result genuinely came from our
    // account; everything else is fetched fresh from the Admin API below.
    if (!dependencies.verifyUploadSignature(env, publicId, version, signature)) {
      logEvent('admin_media_finalize_signature_invalid');
      return response.status(422).json({ error: 'Solicitud invalida.', requestId: auth.requestId });
    }

    const resource = await dependencies.fetchResourceMetadata(env, publicId);
    if (!resource) {
      logEvent('admin_media_finalize_resource_unavailable');
      return response.status(503).json({ error: 'No disponible.' });
    }

    const metadata = validateResourceMetadata(resource);
    if (!isValid(metadata)) {
      // The signature was valid, so this public_id is genuinely ours -- safe to destroy.
      const destroyResult = await dependencies.destroyAsset(env, publicId);
      logEvent('admin_media_finalize_policy_rejected', { destroyed: destroyResult.ok });
      return response.status(422).json({ error: 'Solicitud invalida.', requestId: auth.requestId });
    }
    if (!isCloudinarySecureUrl(metadata.value.secureUrl)) {
      const destroyResult = await dependencies.destroyAsset(env, publicId);
      logEvent('admin_media_finalize_url_rejected', { destroyed: destroyResult.ok });
      return response.status(422).json({ error: 'Solicitud invalida.', requestId: auth.requestId });
    }

    const mimeType = mimeTypeForFormat(metadata.value.format);
    if (!mimeType) {
      const destroyResult = await dependencies.destroyAsset(env, publicId);
      logEvent('admin_media_finalize_format_rejected', { destroyed: destroyResult.ok });
      return response.status(422).json({ error: 'Solicitud invalida.', requestId: auth.requestId });
    }

    const { data, error } = await auth.rpc.rpc('admin_finalize_media_asset', {
      p_public_id: publicId,
      p_secure_url: metadata.value.secureUrl,
      p_format: metadata.value.format,
      p_mime_type: mimeType,
      p_bytes: metadata.value.bytes,
      p_width: metadata.value.width,
      p_height: metadata.value.height,
      p_request_id: auth.requestId,
    });

    if (error || !data) {
      const mapped = mapAdminRpcError(error);
      logEvent('admin_media_finalize_failed', { status: mapped.status });
      return response.status(mapped.status).json({ error: mapped.error, requestId: auth.requestId });
    }

    logEvent('admin_media_finalized');
    const asset = data as { id: string; secure_url: string; status: string };
    return response.status(200).json({
      mediaAssetId: asset.id,
      url: asset.secure_url,
      status: asset.status,
      requestId: auth.requestId,
    });
  };
}
