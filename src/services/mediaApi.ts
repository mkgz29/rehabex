// Browser-side orchestration for the ADMIN-01C secure upload flow:
// sign -> direct upload to Cloudinary -> finalize. The panel never writes an
// arbitrary URL; it only ever receives back an opaque mediaAssetId and a
// preview URL once the server has verified the result.
import { supabase } from '../lib/supabase';

export type MediaIntent = 'product' | 'hero' | 'about';

export type MediaUploadStage = 'validation' | 'sign' | 'upload' | 'finalize';

export class MediaUploadError extends Error {
  readonly stage: MediaUploadStage;

  constructor(stage: MediaUploadStage, message: string) {
    super(message);
    this.stage = stage;
  }
}

const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_BYTES = 8 * 1024 * 1024;
const MIN_DIMENSION = 400;
const MAX_DIMENSION = 6000;

function readImageDimensions(file: File): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      resolve({ width: image.naturalWidth, height: image.naturalHeight });
      URL.revokeObjectURL(url);
    };
    image.onerror = () => {
      reject(new Error('invalid_image'));
      URL.revokeObjectURL(url);
    };
    image.src = url;
  });
}

/**
 * UX-only pre-checks. None of this is a security boundary: the server
 * re-verifies format, size and dimensions from Cloudinary's own Admin API
 * response, never from what the browser claims.
 */
export async function validateFileForUpload(file: File): Promise<{ ok: true } | { ok: false; message: string }> {
  if (!ALLOWED_MIME_TYPES.includes(file.type)) {
    return { ok: false, message: 'Formato no permitido. Usa una imagen JPG, PNG o WebP.' };
  }
  if (file.size > MAX_BYTES) {
    return { ok: false, message: 'La imagen supera el tamano maximo de 8 MB.' };
  }
  const dimensions = await readImageDimensions(file).catch(() => null);
  if (!dimensions) return { ok: false, message: 'No se pudo leer la imagen seleccionada.' };
  if (dimensions.width < MIN_DIMENSION || dimensions.height < MIN_DIMENSION) {
    return { ok: false, message: `La imagen debe tener al menos ${MIN_DIMENSION}x${MIN_DIMENSION}px.` };
  }
  if (dimensions.width > MAX_DIMENSION || dimensions.height > MAX_DIMENSION) {
    return { ok: false, message: `La imagen no puede superar ${MAX_DIMENSION}x${MAX_DIMENSION}px.` };
  }
  return { ok: true };
}

async function getAccessToken(stage: MediaUploadStage): Promise<string> {
  if (!supabase) throw new MediaUploadError(stage, 'Supabase no esta configurado.');
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new MediaUploadError(stage, 'Tu sesion expiro. Volve a iniciar sesion.');
  return token;
}

function messageForStatus(status: number) {
  switch (status) {
    case 401:
      return 'Tu sesion expiro. Volve a iniciar sesion.';
    case 403:
      return 'No tenes permisos de administrador para subir imagenes.';
    case 409:
      return 'La autorizacion de carga vencio. Volve a intentar la carga.';
    case 422:
      return 'No se pudo procesar la imagen. Proba con otro archivo.';
    default:
      return 'No se pudo completar la carga. Intenta nuevamente.';
  }
}

type SignResponse = {
  mediaAssetId: string;
  uploadUrl: string;
  cloudName: string;
  apiKey: string;
  timestamp: number;
  publicId: string;
  folder: string;
  overwrite: string;
  allowedFormats: string;
  maxFileSize: number;
  signature: string;
  requestId: string;
};

async function requestSign(intent: MediaIntent): Promise<SignResponse> {
  const token = await getAccessToken('sign');
  const response = await fetch('/api/admin/media/sign', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ intent }),
  });
  if (!response.ok) throw new MediaUploadError('sign', messageForStatus(response.status));
  return (await response.json()) as SignResponse;
}

type CloudinaryUploadResult = { publicId: string; version: number; signature: string };

function uploadToCloudinary(
  file: File,
  sign: SignResponse,
  onProgress?: (percent: number) => void,
  signal?: AbortSignal,
): Promise<CloudinaryUploadResult> {
  return new Promise((resolve, reject) => {
    // Only the fields the server signed are sent. Adding, removing or
    // changing any of them would invalidate Cloudinary's own signature
    // check on their side, independently of anything our backend verifies.
    const formData = new FormData();
    formData.append('file', file);
    formData.append('api_key', sign.apiKey);
    formData.append('timestamp', String(sign.timestamp));
    formData.append('public_id', sign.publicId);
    formData.append('folder', sign.folder);
    formData.append('overwrite', sign.overwrite);
    formData.append('allowed_formats', sign.allowedFormats);
    formData.append('max_file_size', String(sign.maxFileSize));
    formData.append('signature', sign.signature);

    const xhr = new XMLHttpRequest();
    xhr.open('POST', sign.uploadUrl);
    xhr.upload.onprogress = (event) => {
      if (onProgress && event.lengthComputable) onProgress(Math.round((event.loaded / event.total) * 100));
    };
    xhr.onload = () => {
      if (xhr.status < 200 || xhr.status >= 300) {
        reject(new MediaUploadError('upload', 'No se pudo subir la imagen a Cloudinary.'));
        return;
      }
      try {
        const body = JSON.parse(xhr.responseText) as { public_id: string; version: number; signature: string };
        resolve({ publicId: body.public_id, version: Number(body.version), signature: body.signature });
      } catch {
        reject(new MediaUploadError('upload', 'No se pudo interpretar la respuesta de Cloudinary.'));
      }
    };
    xhr.onerror = () => reject(new MediaUploadError('upload', 'No se pudo subir la imagen a Cloudinary.'));
    xhr.onabort = () => reject(new MediaUploadError('upload', 'Carga cancelada.'));
    signal?.addEventListener('abort', () => xhr.abort());
    xhr.send(formData);
  });
}

type FinalizeResponse = { mediaAssetId: string; url: string; status: string; requestId: string };

async function requestFinalize(result: CloudinaryUploadResult): Promise<FinalizeResponse> {
  const token = await getAccessToken('finalize');
  const response = await fetch('/api/admin/media/finalize', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(result),
  });
  if (!response.ok) throw new MediaUploadError('finalize', messageForStatus(response.status));
  return (await response.json()) as FinalizeResponse;
}

export type UploadSecureImageOptions = {
  onProgress?: (percent: number) => void;
  /** Fired once Cloudinary accepted the upload, before the backend verifies it. */
  onUploaded?: () => void;
  signal?: AbortSignal;
};

/** Full sign -> upload -> finalize flow for one file. Throws MediaUploadError on any failure. */
export async function uploadSecureImage(file: File, intent: MediaIntent, options: UploadSecureImageOptions = {}): Promise<{ assetId: string; url: string }> {
  const validation = await validateFileForUpload(file);
  if (!validation.ok) throw new MediaUploadError('validation', validation.message);

  const sign = await requestSign(intent);
  const uploadResult = await uploadToCloudinary(file, sign, options.onProgress, options.signal);
  options.onUploaded?.();
  const finalized = await requestFinalize(uploadResult);
  return { assetId: finalized.mediaAssetId, url: finalized.url };
}
