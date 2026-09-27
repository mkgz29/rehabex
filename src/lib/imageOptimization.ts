// Client-side "prepare before upload" step. Purely a UX improvement: it lets
// an admin pick a larger, unrotated, straight-out-of-a-phone original and
// still end up with a file that already satisfies the server's real limits
// (services/mediaApi.ts's validateFileForUpload, unchanged and still the
// actual security boundary -- this never lowers what the server accepts).

export const MAX_SELECTABLE_BYTES = 20 * 1024 * 1024;
const MAX_OUTPUT_BYTES = 8 * 1024 * 1024;
const MAX_OUTPUT_DIMENSION = 2400;
const MIN_ACCEPTABLE_DIMENSION = 400;
const TOO_SMALL_MESSAGE = 'Esta imagen es demasiado pequeña y podría verse borrosa.';

export class ImagePreparationError extends Error {}

/** Never upscales: a source already inside the ceiling keeps its own size. */
export function computeTargetDimensions(width: number, height: number, maxDimension = MAX_OUTPUT_DIMENSION): { width: number; height: number } {
  const largest = Math.max(width, height);
  const scale = largest > maxDimension ? maxDimension / largest : 1;
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/** PNG keeps transparency by re-encoding to WebP (which also supports alpha) instead of JPEG, which would flatten it. */
export function pickOutputMimeType(sourceType: string): 'image/webp' | 'image/jpeg' {
  return sourceType === 'image/png' ? 'image/webp' : 'image/jpeg';
}

export function isTooSmall(width: number, height: number, minDimension = MIN_ACCEPTABLE_DIMENSION): boolean {
  return width < minDimension || height < minDimension;
}

function outputExtension(mimeType: 'image/webp' | 'image/jpeg'): string {
  return mimeType === 'image/webp' ? 'webp' : 'jpg';
}

function renamedFile(originalName: string, mimeType: 'image/webp' | 'image/jpeg'): string {
  const base = originalName.replace(/\.[^./\\]+$/, '');
  return `${base || 'imagen'}.${outputExtension(mimeType)}`;
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new ImagePreparationError('No pudimos preparar esta imagen para subir. Probá con otro archivo.'))),
      type,
      quality,
    );
  });
}

export type OptimizeImageResult = { file: File; warning: string | null };

/**
 * Corrects phone-photo orientation (createImageBitmap's imageOrientation:
 * 'from-image' applies the EXIF orientation tag automatically, so the pixels
 * are already right-side-up -- no manual EXIF parsing needed), downsizes to a
 * safe ceiling, and re-encodes to JPG/WebP under the server's byte limit.
 * Throws ImagePreparationError with a plain-language message on failure;
 * never silently produces a file the server would reject anyway.
 */
export async function optimizeImageForUpload(file: File): Promise<OptimizeImageResult> {
  if (!file.type.startsWith('image/')) {
    throw new ImagePreparationError('Ese archivo no es una imagen. Elegí una foto en formato JPG, PNG o WebP.');
  }
  if (file.size > MAX_SELECTABLE_BYTES) {
    throw new ImagePreparationError('Esta imagen es demasiado pesada. Elegí una de hasta 20 MB.');
  }

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    throw new ImagePreparationError('No pudimos leer esta imagen. Probá con otro archivo.');
  }

  const warning = isTooSmall(bitmap.width, bitmap.height) ? TOO_SMALL_MESSAGE : null;
  const { width, height } = computeTargetDimensions(bitmap.width, bitmap.height);

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new ImagePreparationError('No pudimos preparar esta imagen en este navegador. Probá con otro archivo.');
  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  const mimeType = pickOutputMimeType(file.type);
  let quality = 0.86;
  let blob = await canvasToBlob(canvas, mimeType, quality);
  while (blob.size > MAX_OUTPUT_BYTES && quality > 0.5) {
    quality -= 0.1;
    blob = await canvasToBlob(canvas, mimeType, quality);
  }
  if (blob.size > MAX_OUTPUT_BYTES) {
    throw new ImagePreparationError('No pudimos reducir esta imagen lo suficiente. Probá con un archivo más liviano.');
  }

  return { file: new File([blob], renamedFile(file.name, mimeType), { type: mimeType }), warning };
}
