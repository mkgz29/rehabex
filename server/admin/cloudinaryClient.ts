// Thin, dependency-injectable wrapper around the official Cloudinary SDK.
// Upload request signing is explicit so the exact serialized fields sent by
// the browser are auditable. Response verification and administrative calls
// continue to use the SDK. The API secret never leaves this server module.
import { createHash } from 'node:crypto';
import { v2 as cloudinary } from 'cloudinary';

export type CloudinaryEnv = { cloudName: string; apiKey: string; apiSecret: string };

export function cloudinaryEnv(): CloudinaryEnv | null {
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME?.trim();
  const apiKey = process.env.CLOUDINARY_API_KEY?.trim();
  const apiSecret = process.env.CLOUDINARY_API_SECRET?.trim();
  if (!cloudName || !apiKey || !apiSecret) return null;
  return { cloudName, apiKey, apiSecret };
}

export type SignedUploadParams = {
  cloudName: string;
  apiKey: string;
  uploadParams: CloudinaryUploadParams;
  signature: string;
  uploadUrl: string;
};

export const ALLOWED_UPLOAD_FORMATS = 'jpg,jpeg,png,webp';
export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;

export type CloudinaryUploadParams = {
  allowed_formats: typeof ALLOWED_UPLOAD_FORMATS;
  folder: string;
  overwrite: 'false';
  public_id: string;
  timestamp: string;
};

type SignableValue = string | number | boolean | null | undefined;
type SignableParams = Record<string, SignableValue>;

const UNSIGNED_PARAMETER_NAMES = new Set(['file', 'api_key', 'cloud_name', 'resource_type', 'signature']);

/** The single source for both the signed values and the browser FormData. */
export function buildCloudinaryUploadParams(params: {
  publicId: string;
  folder: string;
  timestamp: number;
}): CloudinaryUploadParams {
  return {
    allowed_formats: ALLOWED_UPLOAD_FORMATS,
    folder: params.folder,
    overwrite: 'false',
    public_id: params.publicId,
    timestamp: String(params.timestamp),
  };
}

/** Cloudinary's canonical request serialization, independent of object insertion order. */
export function canonicalizeCloudinaryParams(params: SignableParams): string {
  return Object.entries(params)
    .filter(([name, value]) => !UNSIGNED_PARAMETER_NAMES.has(name) && value !== null && value !== undefined && value !== '')
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([name, value]) => `${name}=${String(value)}`)
    .join('&');
}

/** Cloudinary signs SHA-1(canonicalString + apiSecret); this is not HMAC. */
export function signCloudinaryParams(params: SignableParams, apiSecret: string): string {
  const canonicalString = canonicalizeCloudinaryParams(params);
  return createHash('sha1').update(canonicalString + apiSecret).digest('hex');
}

/**
 * Computes the signature for a fixed, server-chosen parameter set. The
 * caller must send back to Cloudinary exactly these fields -- anything else
 * added or changed invalidates Cloudinary's own signature check on their
 * side, independently of anything this app verifies afterward.
 */
export function signUploadParams(
  env: CloudinaryEnv,
  params: { publicId: string; folder: string; timestamp: number },
): SignedUploadParams {
  const uploadParams = buildCloudinaryUploadParams(params);
  const signature = signCloudinaryParams(uploadParams, env.apiSecret);
  return {
    cloudName: env.cloudName,
    apiKey: env.apiKey,
    uploadParams,
    signature,
    uploadUrl: `https://api.cloudinary.com/v1_1/${env.cloudName}/image/upload`,
  };
}

/**
 * Verifies that an upload result genuinely came from Cloudinary under our
 * own account: recomputes the signature the same way
 * cloudinary.utils.verify_api_response_signature does internally, using the
 * typed api_sign_request rather than that undocumented/untyped helper.
 */
export function verifyUploadSignature(env: CloudinaryEnv, publicId: string, version: number, signature: string): boolean {
  const expected = cloudinary.utils.api_sign_request({ public_id: publicId, version }, env.apiSecret);
  return expected === signature;
}

/**
 * Fetches the ground-truth resource metadata for a public_id directly from
 * Cloudinary's Admin API, using server credentials. This -- never anything
 * the browser claims -- is the source of truth for format, size, dimensions
 * and resource type: a tampered browser could otherwise lie about all of
 * those while still holding a validly-signed public_id/version pair.
 */
export async function fetchResourceMetadata(env: CloudinaryEnv, publicId: string): Promise<Record<string, unknown> | null> {
  cloudinary.config({ cloud_name: env.cloudName, api_key: env.apiKey, api_secret: env.apiSecret, secure: true });
  try {
    return await cloudinary.api.resource(publicId, { resource_type: 'image' });
  } catch {
    return null;
  }
}

/**
 * Best-effort cleanup for an upload that was verified as genuinely ours
 * (matching public_id, valid signature) but fails our own policy (format,
 * size, dimensions). Never call this for an unverified result: a forged
 * public_id could belong to someone else's unrelated Cloudinary asset.
 */
export async function destroyAsset(env: CloudinaryEnv, publicId: string): Promise<{ ok: boolean }> {
  cloudinary.config({ cloud_name: env.cloudName, api_key: env.apiKey, api_secret: env.apiSecret, secure: true });
  try {
    const result = await cloudinary.uploader.destroy(publicId, { resource_type: 'image', invalidate: true });
    return { ok: result?.result === 'ok' || result?.result === 'not found' };
  } catch {
    return { ok: false };
  }
}

const SECURE_URL_HOST = /(^|\.)res\.cloudinary\.com$/;

export function isCloudinarySecureUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && SECURE_URL_HOST.test(parsed.hostname);
  } catch {
    return false;
  }
}
