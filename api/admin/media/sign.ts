import { randomUUID } from 'node:crypto';

import { mapAdminRpcError } from '../../../server/admin/adminErrors.js';
import { cloudinaryEnv, signUploadParams, type CloudinaryEnv } from '../../../server/admin/cloudinaryClient.js';
import { FOLDER_BY_INTENT, isValid, parseMediaSignPayload } from '../../../server/admin/mediaValidators.js';
import { defaultRequireAdminDependencies, requireAdmin, type RequireAdminDependencies } from '../../../server/admin/requireAdmin.js';
import { applyAdminCors, logEvent, type ApiRequest, type ApiResponse } from '../../../server/commerce/commerce.js';

export const config = { api: { bodyParser: false } };

export type SignDependencies = RequireAdminDependencies & { cloudinaryEnv: () => CloudinaryEnv | null };

const defaultSignDependencies: SignDependencies = { ...defaultRequireAdminDependencies, cloudinaryEnv };

export default createAdminMediaSignHandler();

export function createAdminMediaSignHandler(overrides: Partial<SignDependencies> = {}) {
  const dependencies: SignDependencies = { ...defaultSignDependencies, ...overrides };

  return async function handler(request: ApiRequest, response: ApiResponse) {
    if (request.method === 'OPTIONS') {
      if (!applyAdminCors(request, response)) return response.status(403).json({ error: 'No autorizado.' });
      return response.status(204).end?.();
    }

    const auth = await requireAdmin(request, response, dependencies);
    if (auth.kind === 'error') return response.status(auth.status).json({ error: auth.error });

    const payload = parseMediaSignPayload(auth.body);
    if (!isValid(payload)) return response.status(422).json({ error: 'Solicitud invalida.', requestId: auth.requestId });

    const env = dependencies.cloudinaryEnv();
    if (!env) {
      logEvent('admin_media_sign_not_configured');
      return response.status(503).json({ error: 'No disponible.' });
    }

    // The server -- never the client -- chooses the folder, the public ID and
    // the timestamp. The client only ever states its intent (product/hero/about).
    const folder = FOLDER_BY_INTENT[payload.value.intent];
    const publicId = randomUUID();
    const timestamp = Math.floor(Date.now() / 1000);

    const { data, error } = await auth.rpc.rpc('admin_create_pending_media_asset', {
      p_public_id: publicId,
      p_folder: folder,
      p_request_id: auth.requestId,
    });

    if (error || !data) {
      const mapped = mapAdminRpcError(error);
      logEvent('admin_media_sign_failed', { status: mapped.status });
      return response.status(mapped.status).json({ error: mapped.error, requestId: auth.requestId });
    }

    const signed = signUploadParams(env, { publicId, folder, timestamp });

    logEvent('admin_media_sign_issued');
    return response.status(200).json({
      mediaAssetId: (data as { id: string }).id,
      uploadUrl: signed.uploadUrl,
      cloudName: signed.cloudName,
      apiKey: signed.apiKey,
      timestamp: signed.timestamp,
      publicId: signed.publicId,
      folder: signed.folder,
      overwrite: signed.overwrite,
      allowedFormats: signed.allowedFormats,
      maxFileSize: signed.maxFileSize,
      signature: signed.signature,
      requestId: auth.requestId,
    });
  };
}
