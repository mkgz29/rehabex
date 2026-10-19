// Browser-side orchestration for the ADMIN-01C secure upload flow:
// sign -> direct upload to Cloudinary -> finalize. The panel never writes an
// arbitrary URL; it only ever receives back an opaque mediaAssetId and a
// preview URL once the server has verified the result.
import { supabase } from '../lib/supabase';

export type MediaIntent = 'product' | 'hero' | 'about';
export type MediaType = 'image' | 'video';

export type MediaUploadStage = 'validation' | 'sign' | 'upload' | 'finalize';

export class MediaUploadError extends Error {
  readonly stage: MediaUploadStage;

  constructor(stage: MediaUploadStage, message: string) {
    super(message);
    this.stage = stage;
  }
}

const ALLOWED_IMAGE_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const ALLOWED_VIDEO_MIME_TYPES = ['video/mp4', 'video/webm'];
const MAX_BYTES = 8 * 1024 * 1024;
const MIN_DIMENSION = 400;
const MAX_DIMENSION = 6000;
const MAX_VIDEO_DURATION_SECONDS = 60;

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

function readVideoMetadata(file: File): Promise<{ width: number; height: number; duration: number }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.onloadedmetadata = () => {
      resolve({ width: video.videoWidth, height: video.videoHeight, duration: video.duration });
      URL.revokeObjectURL(url);
    };
    video.onerror = () => {
      reject(new Error('invalid_video'));
      URL.revokeObjectURL(url);
    };
    video.src = url;
  });
}

/**
 * UX-only pre-checks. None of this is a security boundary: the server
 * re-verifies format, size and dimensions from Cloudinary's own Admin API
 * response, never from what the browser claims.
 */
export async function validateFileForUpload(file: File): Promise<{ ok: true } | { ok: false; message: string }> {
  if (!ALLOWED_IMAGE_MIME_TYPES.includes(file.type)) {
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

export async function validateVideoFileForUpload(file: File): Promise<{ ok: true } | { ok: false; message: string }> {
  if (!ALLOWED_VIDEO_MIME_TYPES.includes(file.type)) {
    return { ok: false, message: 'Formato no permitido. Usá un video MP4 o WebM.' };
  }
  if (file.size > MAX_BYTES) {
    return { ok: false, message: 'El video supera el tamaño máximo de 8 MB.' };
  }
  const metadata = await readVideoMetadata(file).catch(() => null);
  if (!metadata) return { ok: false, message: 'No se pudo leer el video seleccionado.' };
  if (metadata.width < MIN_DIMENSION || metadata.height < MIN_DIMENSION) {
    return { ok: false, message: `El video debe tener al menos ${MIN_DIMENSION}x${MIN_DIMENSION}px.` };
  }
  if (metadata.width > MAX_DIMENSION || metadata.height > MAX_DIMENSION) {
    return { ok: false, message: `El video no puede superar ${MAX_DIMENSION}x${MAX_DIMENSION}px.` };
  }
  if (!Number.isFinite(metadata.duration) || metadata.duration <= 0 || metadata.duration > MAX_VIDEO_DURATION_SECONDS) {
    return { ok: false, message: `El video debe durar hasta ${MAX_VIDEO_DURATION_SECONDS} segundos.` };
  }
  return { ok: true };
}

export function mediaTypeForFile(file: File): MediaType | null {
  if (ALLOWED_IMAGE_MIME_TYPES.includes(file.type)) return 'image';
  if (ALLOWED_VIDEO_MIME_TYPES.includes(file.type)) return 'video';
  return null;
}

export function validateMediaFileForUpload(file: File, mediaType: MediaType) {
  return mediaType === 'video' ? validateVideoFileForUpload(file) : validateFileForUpload(file);
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
      return 'No tenes permisos de administrador para subir archivos.';
    case 409:
      return 'La autorizacion de carga vencio. Volve a intentar la carga.';
    case 422:
      return 'No se pudo procesar el archivo. Proba con otro.';
    default:
      return 'No se pudo completar la carga. Intenta nuevamente.';
  }
}

type SignResponse = {
  mediaAssetId: string;
  uploadUrl: string;
  cloudName: string;
  apiKey: string;
  uploadParams: {
    allowed_formats: string;
    folder: string;
    overwrite: 'false';
    public_id: string;
    timestamp: string;
  };
  signature: string;
  requestId: string;
};

async function requestSign(intent: MediaIntent, mediaType: MediaType): Promise<SignResponse> {
  const token = await getAccessToken('sign');
  const response = await fetch('/api/admin/media/sign', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ intent, mediaType }),
  });
  if (!response.ok) throw new MediaUploadError('sign', messageForStatus(response.status));
  return (await response.json()) as SignResponse;
}

type CloudinaryUploadResult = { publicId: string; version: number; signature: string };

export function buildCloudinaryUploadFormData(file: File, sign: SignResponse): FormData {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('api_key', sign.apiKey);
  for (const [name, value] of Object.entries(sign.uploadParams)) {
    formData.append(name, value);
  }
  formData.append('signature', sign.signature);
  return formData;
}

function uploadToCloudinary(
  file: File,
  sign: SignResponse,
  onProgress?: (percent: number) => void,
  signal?: AbortSignal,
): Promise<CloudinaryUploadResult> {
  return new Promise((resolve, reject) => {
    // The exact object signed by the server is serialized without rebuilding
    // or renaming fields in the browser.
    const formData = buildCloudinaryUploadFormData(file, sign);

    const xhr = new XMLHttpRequest();
    xhr.open('POST', sign.uploadUrl);
    xhr.upload.onprogress = (event) => {
      if (onProgress && event.lengthComputable) onProgress(Math.round((event.loaded / event.total) * 100));
    };
    xhr.onload = () => {
      if (xhr.status < 200 || xhr.status >= 300) {
        reject(new MediaUploadError('upload', 'No se pudo subir el archivo a Cloudinary.'));
        return;
      }
      try {
        const body = JSON.parse(xhr.responseText) as { public_id: string; version: number; signature: string };
        resolve({ publicId: body.public_id, version: Number(body.version), signature: body.signature });
      } catch {
        reject(new MediaUploadError('upload', 'No se pudo interpretar la respuesta de Cloudinary.'));
      }
    };
    xhr.onerror = () => reject(new MediaUploadError('upload', 'No se pudo subir el archivo a Cloudinary.'));
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

export type UploadSecureMediaOptions = {
  onProgress?: (percent: number) => void;
  /** Fired once Cloudinary accepted the upload, before the backend verifies it. */
  onUploaded?: () => void;
  signal?: AbortSignal;
};

/** Full sign -> upload -> finalize flow for one file. Throws MediaUploadError on any failure. */
export async function uploadSecureImage(file: File, intent: MediaIntent, options: UploadSecureImageOptions = {}): Promise<{ assetId: string; url: string }> {
  const validation = await validateFileForUpload(file);
  if (!validation.ok) throw new MediaUploadError('validation', validation.message);

  const sign = await requestSign(intent, 'image');
  const uploadResult = await uploadToCloudinary(file, sign, options.onProgress, options.signal);
  options.onUploaded?.();
  const finalized = await requestFinalize(uploadResult);
  return { assetId: finalized.mediaAssetId, url: finalized.url };
}

export type UploadSecureImageOptions = UploadSecureMediaOptions;

/** Full secure upload flow for an image or an About video. */
export async function uploadSecureMedia(
  file: File,
  intent: MediaIntent,
  mediaType: MediaType,
  options: UploadSecureMediaOptions = {},
): Promise<{ assetId: string; url: string; mediaType: MediaType }> {
  if (mediaType === 'video' && intent !== 'about') {
    throw new MediaUploadError('validation', 'Los videos solo están permitidos en Acerca de Rehabex.');
  }
  const validation = await validateMediaFileForUpload(file, mediaType);
  if (!validation.ok) throw new MediaUploadError('validation', validation.message);

  const sign = await requestSign(intent, mediaType);
  const uploadResult = await uploadToCloudinary(file, sign, options.onProgress, options.signal);
  options.onUploaded?.();
  const finalized = await requestFinalize(uploadResult);
  return { assetId: finalized.mediaAssetId, url: finalized.url, mediaType };
}
