// Server-only, dependency-free payload validators for the ADMIN-01C secure
// media boundary. Every field is explicitly allowlisted; the client never
// chooses a folder, public ID, resource type or transformation.
import { IMAGE_UPLOAD_FORMATS, MAX_UPLOAD_BYTES, VIDEO_UPLOAD_FORMATS, type CloudinaryMediaType } from './cloudinaryClient.js';

export type ValidationResult<T> = { ok: true; value: T } | { ok: false; error: string };

export function isValid<T>(result: ValidationResult<T>): result is { ok: true; value: T } {
  return result.ok === true;
}

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function hasOnlyAllowedKeys(input: Record<string, unknown>, allowed: readonly string[]) {
  return !Object.keys(input).some((key) => !allowed.includes(key));
}

// --- /api/admin/media/sign ---------------------------------------------------

export type MediaIntent = 'product' | 'hero' | 'about';
export type MediaType = CloudinaryMediaType;

/** The only server-controlled mapping from a content intent to a Cloudinary folder. */
export const FOLDER_BY_INTENT: Record<MediaIntent, string> = {
  product: 'rehabex/products',
  hero: 'rehabex/hero',
  about: 'rehabex/about',
};

const SIGN_FIELD_KEYS = ['intent', 'mediaType'] as const;

export function parseMediaSignPayload(value: unknown): ValidationResult<{ intent: MediaIntent; mediaType: MediaType }> {
  const input = asObject(value);
  if (!input) return { ok: false, error: 'invalid_payload' };
  if (!hasOnlyAllowedKeys(input, SIGN_FIELD_KEYS)) return { ok: false, error: 'unknown_field' };
  const intent = input.intent;
  if (intent !== 'product' && intent !== 'hero' && intent !== 'about') return { ok: false, error: 'invalid_intent' };
  const mediaType = input.mediaType === undefined ? 'image' : input.mediaType;
  if (mediaType !== 'image' && mediaType !== 'video') return { ok: false, error: 'invalid_media_type' };
  if (mediaType === 'video' && intent !== 'about') return { ok: false, error: 'invalid_media_type' };
  return { ok: true, value: { intent, mediaType } };
}

export function folderForUpload(intent: MediaIntent, mediaType: MediaType): string {
  const baseFolder = FOLDER_BY_INTENT[intent];
  return mediaType === 'video' ? `${baseFolder}/video` : baseFolder;
}

// --- /api/admin/media/finalize ------------------------------------------------

// The browser only ever proves *which* upload it means (publicId + version +
// Cloudinary's own signature over exactly those two fields). It is never
// trusted for format, byte size, dimensions or resource type: a tampered
// browser could claim anything there. The finalize endpoint fetches that
// metadata itself from Cloudinary's Admin API (server credentials only)
// and validates the result of *that* call with validateResourceMetadata
// below, never the client's claims.
export type MediaFinalizeInput = { publicId: string; version: number; signature: string };

const FINALIZE_FIELD_KEYS = ['publicId', 'version', 'signature'] as const;

const UUID_V4_PATTERN = '[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const PUBLIC_ID_PATTERN = new RegExp(`^rehabex/(?:products|hero|about(?:/video)?)/${UUID_V4_PATTERN}$`);
const SIGNATURE_PATTERN = /^[a-f0-9]{40,64}$/;
const IMAGE_FORMATS = new Set(IMAGE_UPLOAD_FORMATS.split(','));
const VIDEO_FORMATS = new Set(VIDEO_UPLOAD_FORMATS.split(','));
const MIN_DIMENSION = 400;
const MAX_DIMENSION = 6000;
const MAX_VIDEO_DURATION_SECONDS = 60;

function isPositiveInt(value: unknown, max: number): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= max;
}

export function parseMediaFinalizePayload(value: unknown): ValidationResult<MediaFinalizeInput> {
  const input = asObject(value);
  if (!input) return { ok: false, error: 'invalid_payload' };
  if (!hasOnlyAllowedKeys(input, FINALIZE_FIELD_KEYS)) return { ok: false, error: 'unknown_field' };

  const publicId = typeof input.publicId === 'string' && PUBLIC_ID_PATTERN.test(input.publicId) ? input.publicId : null;
  if (!publicId) return { ok: false, error: 'invalid_public_id' };
  if (!isPositiveInt(input.version, 9_999_999_999)) return { ok: false, error: 'invalid_version' };
  const signature = typeof input.signature === 'string' && SIGNATURE_PATTERN.test(input.signature) ? input.signature : null;
  if (!signature) return { ok: false, error: 'invalid_signature' };

  return { ok: true, value: { publicId, version: input.version as number, signature } };
}

export type CloudinaryResourceMetadata = {
  format: string;
  resourceType: string;
  bytes: number;
  width: number;
  height: number;
  secureUrl: string;
  duration: number | null;
};

const MIME_BY_FORMAT: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  mp4: 'video/mp4',
  webm: 'video/webm',
};

export function mimeTypeForFormat(format: string): string | null {
  return MIME_BY_FORMAT[format.toLowerCase()] ?? null;
}

export function mediaTypeFromPublicId(publicId: string): MediaType {
  return publicId.startsWith('rehabex/about/video/') ? 'video' : 'image';
}

/** Validates the ground-truth metadata fetched from Cloudinary's Admin API against upload policy. */
export function validateResourceMetadata(resource: {
  format?: unknown;
  resource_type?: unknown;
  bytes?: unknown;
  width?: unknown;
  height?: unknown;
  secure_url?: unknown;
  duration?: unknown;
}, expectedMediaType: MediaType = 'image'): ValidationResult<CloudinaryResourceMetadata> {
  const format = typeof resource.format === 'string' ? resource.format.toLowerCase() : '';
  const allowedFormats = expectedMediaType === 'video' ? VIDEO_FORMATS : IMAGE_FORMATS;
  if (!allowedFormats.has(format)) return { ok: false, error: 'invalid_format' };
  if (resource.resource_type !== expectedMediaType) return { ok: false, error: 'invalid_resource_type' };
  if (!isPositiveInt(resource.bytes, MAX_UPLOAD_BYTES)) return { ok: false, error: 'invalid_bytes' };
  if (!isPositiveInt(resource.width, MAX_DIMENSION) || (resource.width as number) < MIN_DIMENSION) return { ok: false, error: 'invalid_width' };
  if (!isPositiveInt(resource.height, MAX_DIMENSION) || (resource.height as number) < MIN_DIMENSION) return { ok: false, error: 'invalid_height' };
  const secureUrl = typeof resource.secure_url === 'string' ? resource.secure_url : null;
  if (!secureUrl) return { ok: false, error: 'invalid_secure_url' };
  const duration = expectedMediaType === 'video' && typeof resource.duration === 'number' ? resource.duration : null;
  if (expectedMediaType === 'video' && (!duration || duration <= 0 || duration > MAX_VIDEO_DURATION_SECONDS)) {
    return { ok: false, error: 'invalid_duration' };
  }

  return {
    ok: true,
    value: { format, resourceType: expectedMediaType, bytes: resource.bytes as number, width: resource.width as number, height: resource.height as number, secureUrl, duration },
  };
}
