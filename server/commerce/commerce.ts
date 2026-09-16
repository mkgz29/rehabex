// Server-only shared commerce utilities. This module is intentionally outside api/.
import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { isIP } from 'node:net';

import { createClient } from '@supabase/supabase-js';

export type ApiRequest = {
  method?: string;
  body?: unknown;
  headers?: Record<string, string | string[] | undefined>;
  query?: Record<string, string | string[] | undefined>;
};

export type ApiResponse = {
  status: (statusCode: number) => ApiResponse;
  json: (body: unknown) => void;
  end?: () => void;
  setHeader?: (name: string, value: string | string[]) => void;
};

export const MAX_CHECKOUT_BODY_BYTES = 16 * 1024;
export const MAX_WEBHOOK_BODY_BYTES = 8 * 1024;
export const MAX_ORDER_STATUS_BODY_BYTES = 512;

export function header(request: ApiRequest, name: string) {
  const value = request.headers?.[name] ?? request.headers?.[name.toLowerCase()];
  return (Array.isArray(value) ? value[0] : value)?.trim() || null;
}

export function query(request: ApiRequest, name: string) {
  const value = request.query?.[name];
  return (Array.isArray(value) ? value[0] : value)?.trim() || null;
}

export function parseJsonBody(body: unknown, maxBytes: number): unknown | null {
  const serialized = typeof body === 'string' ? body : JSON.stringify(body ?? null);
  if (Buffer.byteLength(serialized, 'utf8') > maxBytes) return null;
  if (typeof body !== 'string') return body;
  try {
    return JSON.parse(body) as unknown;
  } catch {
    return null;
  }
}

export type JsonBodyRead = { ok: true; value: unknown } | { ok: false; reason: 'content_length' | 'too_large' | 'invalid' };

export async function readJsonBody(request: ApiRequest, maxBytes: number): Promise<JsonBodyRead> {
  const contentLength = header(request, 'content-length');
  if (contentLength && (!/^\d+$/.test(contentLength) || Number(contentLength) > maxBytes)) return { ok: false, reason: 'content_length' };
  const body = request.body;
  if (isAsyncIterable(body)) {
    const chunks: Buffer[] = [];
    let length = 0;
    for await (const chunk of body) {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      length += bytes.length;
      if (length > maxBytes) return { ok: false, reason: 'too_large' };
      chunks.push(bytes);
    }
    try { return { ok: true, value: JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown }; } catch { return { ok: false, reason: 'invalid' }; }
  }
  const serialized = typeof body === 'string' ? body : JSON.stringify(body ?? null);
  if (Buffer.byteLength(serialized, 'utf8') > maxBytes) return { ok: false, reason: 'too_large' };
  if (typeof body !== 'string') return { ok: true, value: body };
  try { return { ok: true, value: JSON.parse(body) as unknown }; } catch { return { ok: false, reason: 'invalid' }; }
}

function isAsyncIterable(value: unknown): value is AsyncIterable<Uint8Array | string> {
  return Boolean(value && typeof value === 'object' && Symbol.asyncIterator in value);
}

export function isJsonContentType(request: ApiRequest) {
  const contentType = header(request, 'content-type');
  return Boolean(contentType && /^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(contentType));
}

export function hash(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

export function keyedHash(value: string, secret: string) {
  return createHmac('sha256', secret).update(value).digest('hex');
}

export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function newStatusToken() {
  return randomBytes(32).toString('base64url');
}

export function newLeaseToken() {
  return randomUUID();
}

export function safeEqualHex(actual: string, expected: string) {
  const a = Buffer.from(actual, 'hex');
  const b = Buffer.from(expected, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

export function serviceClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

export function backendUrls() {
  const site = requiredHttpsUrl('PUBLIC_SITE_URL');
  const notification = requiredHttpsUrl('MERCADOPAGO_WEBHOOK_URL');
  return { site, notification };
}

function requiredHttpsUrl(name: string) {
  const raw = process.env[name]?.trim();
  if (!raw) throw new Error(`missing ${name}`);
  const value = new URL(raw);
  if (value.protocol !== 'https:') throw new Error(`invalid ${name}`);
  return value.toString().replace(/\/$/, '');
}

export function applyCors(request: ApiRequest, response: ApiResponse) {
  const origin = header(request, 'origin');
  const production = process.env.NODE_ENV === 'production';
  const configured = (process.env.ALLOWED_ORIGINS ?? '').split(',').map((item) => item.trim()).filter(Boolean);
  const allowed = new Set(configured);
  if (!production) {
    allowed.add('http://localhost:5173');
    allowed.add('http://127.0.0.1:5173');
  }
  // Checkout and guest-status are browser-only endpoints. Origin is required
  // here as a browser boundary, never as authentication or abuse prevention.
  if (production && allowed.size === 0) return false;
  if (!origin || !allowed.has(origin)) return false;
  response.setHeader?.('Access-Control-Allow-Origin', origin);
  response.setHeader?.('Vary', 'Origin');
  response.setHeader?.('Access-Control-Allow-Methods', 'POST, OPTIONS');
  response.setHeader?.('Access-Control-Allow-Headers', 'Content-Type, Idempotency-Key, X-Order-Status-Token');
  return true;
}

export function trustedClientIp(request: ApiRequest) {
  // Vercel overwrites this header at its edge. Deliberately ignore
  // X-Forwarded-For, which is user-controlled before a proxy is configured.
  const value = header(request, 'x-vercel-forwarded-for');
  if (!value || value.includes(',') || isIP(value) === 0) return null;
  return value.toLowerCase();
}

export async function consumeRateLimit(
  supabase: NonNullable<ReturnType<typeof serviceClient>>,
  scope: 'checkout' | 'order_status',
  request: ApiRequest,
  idempotencyKey?: string,
) {
  const secret = process.env.COMMERCE_RATE_LIMIT_HASH_SECRET;
  const ip = trustedClientIp(request);
  if (!secret || !ip) return { ok: false as const, retryAfter: 0, unavailable: true };
  const subjects = [keyedHash(`ip:${ip}`, secret)];
  if (scope === 'checkout' && idempotencyKey) subjects.push(keyedHash(`idempotency:${idempotencyKey}`, secret));
  const { data, error } = await supabase.rpc('consume_commerce_rate_limit', { p_scope: scope, p_subject_hashes: subjects });
  if (error || !Array.isArray(data) || data.length !== 1) return { ok: false as const, retryAfter: 0, unavailable: true };
  return { ok: Boolean(data[0].allowed), retryAfter: Number(data[0].retry_after_seconds) || 1, unavailable: false };
}

export function setRetryAfter(response: ApiResponse, seconds: number) {
  response.setHeader?.('Retry-After', String(Math.max(1, seconds)));
}

export function logEvent(code: string, context: Record<string, string | number | boolean | undefined> = {}) {
  // Never pass request bodies, provider responses, tokens, PII, or credentials.
  console.info('[commerce]', { code, ...context });
}
