// Server-only, dependency-free payload validators for the ADMIN-01B boundary.
// Every admin endpoint rejects unknown fields and coerced/ambiguous values
// here, before anything reaches an RPC. Kept framework-free so it is directly
// unit-testable.

export type ValidationResult<T> = { ok: true; value: T } | { ok: false; error: string };

/**
 * Explicit type guard instead of a bare `result.ok` check. Under this repo's
 * tsconfig.vercel-api.json (strictNullChecks disabled for Vercel function
 * compatibility), TypeScript's control-flow narrowing on a generic
 * discriminated union does not reliably narrow `ValidationResult<T>` on its
 * own; a declared type predicate sidesteps that and narrows correctly either
 * way.
 */
export function isValid<T>(result: ValidationResult<T>): result is { ok: true; value: T } {
  return result.ok === true;
}

const MAX_NAME = 160;
const MAX_DESCRIPTION = 4000;
const MAX_CATEGORY = 80;
const MAX_PRICE = 100_000_000;
const MAX_DISPLAY_ORDER = 100_000;
const MAX_IMAGE_URL = 2000;
const MAX_HERO_SUBTITLE = 300;
const MAX_CTA_TEXT = 60;
const MAX_CTA_LINK = 200;
const MAX_ABOUT_DESCRIPTION = 2000;
const MAX_METRICS = 6;
const MAX_METRIC_ID = 40;
const MAX_METRIC_VALUE = 20;
const MAX_METRIC_LABEL = 200;

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const RESERVED_CATEGORIES = new Set(['test', 'prueba']);

export function isReservedCategory(category: string) {
  return RESERVED_CATEGORIES.has(category.trim().toLowerCase());
}

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function hasOnlyAllowedKeys(input: Record<string, unknown>, allowed: readonly string[]) {
  return !Object.keys(input).some((key) => !allowed.includes(key));
}

/** Required text field: exact string type, trimmed, non-empty, bounded. */
function requiredText(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= max && !/[<>]/.test(trimmed) ? trimmed : null;
}

/** Optional text field: absent/null becomes '', otherwise exact string type, bounded. */
function optionalText(value: unknown, max: number): string | null {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length <= max && !/[<>]/.test(trimmed) ? trimmed : null;
}

function isValidPrice(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= MAX_PRICE;
}

function isNonNegativeInt(value: unknown, max: number): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= max;
}

function isHttpsUrl(value: string) {
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}

/** Empty is allowed (keep the existing image, per ADMIN-01A); if present it must be a safe HTTPS URL. */
function optionalImageUrl(value: unknown): { ok: true; value: string | null } | { ok: false } {
  if (value === undefined || value === null || value === '') return { ok: true, value: null };
  if (typeof value !== 'string' || value.length > MAX_IMAGE_URL) return { ok: false };
  return isHttpsUrl(value) ? { ok: true, value: value.trim() } : { ok: false };
}

function requiredImageUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_IMAGE_URL) return null;
  return isHttpsUrl(value) ? value.trim() : null;
}

function isValidTimestamp(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 64 && !Number.isNaN(Date.parse(value));
}

/** Internal route/anchor, or an approved HTTPS destination. Never javascript:/data:/etc. */
function isSafeCtaLink(value: string) {
  if (/[<>]/.test(value)) return false;
  if (value.startsWith('/') || value.startsWith('#')) return true;
  return isHttpsUrl(value);
}

// --- Products ---------------------------------------------------------------

export type ProductFieldsInput = {
  name: string;
  description: string;
  category: string;
  price: number;
  imageUrl: string | null;
  imageAssetId: string | null;
  isFeatured: boolean;
  displayOrder: number;
};

const PRODUCT_FIELD_KEYS = ['name', 'description', 'category', 'price', 'imageUrl', 'imageAssetId', 'isFeatured', 'displayOrder'] as const;

/** Absent/null is fine (no new upload this edit); if present it must be a UUID naming a media asset. */
function optionalAssetId(value: unknown): { ok: true; value: string | null } | { ok: false } {
  if (value === undefined || value === null) return { ok: true, value: null };
  return typeof value === 'string' && UUID.test(value) ? { ok: true, value } : { ok: false };
}

function parseProductFields(input: Record<string, unknown>, options: { rejectReservedCategory: boolean }): ValidationResult<ProductFieldsInput> {
  const name = requiredText(input.name, MAX_NAME);
  if (!name) return { ok: false, error: 'invalid_name' };

  const category = requiredText(input.category, MAX_CATEGORY);
  if (!category) return { ok: false, error: 'invalid_category' };
  if (options.rejectReservedCategory && isReservedCategory(category)) return { ok: false, error: 'reserved_category' };

  if (!isValidPrice(input.price)) return { ok: false, error: 'invalid_price' };

  const description = optionalText(input.description, MAX_DESCRIPTION);
  if (description === null) return { ok: false, error: 'invalid_description' };

  const image = optionalImageUrl(input.imageUrl);
  if (!image.ok) return { ok: false, error: 'invalid_image_url' };
  const imageAssetId = optionalAssetId(input.imageAssetId);
  if (!imageAssetId.ok) return { ok: false, error: 'invalid_image_asset_id' };
  // A brand-new upload (imageAssetId) and a client-chosen URL are mutually
  // exclusive: the server always resolves the canonical URL from the asset.
  if (imageAssetId.value && image.value) return { ok: false, error: 'ambiguous_image' };

  if (typeof input.isFeatured !== 'boolean') return { ok: false, error: 'invalid_is_featured' };
  if (!isNonNegativeInt(input.displayOrder, MAX_DISPLAY_ORDER)) return { ok: false, error: 'invalid_display_order' };

  return {
    ok: true,
    value: {
      name,
      description,
      category,
      price: input.price as number,
      imageUrl: image.value,
      imageAssetId: imageAssetId.value,
      isFeatured: input.isFeatured,
      displayOrder: input.displayOrder as number,
    },
  };
}

export function parseCreateProductPayload(value: unknown): ValidationResult<ProductFieldsInput> {
  const input = asObject(value);
  if (!input) return { ok: false, error: 'invalid_payload' };
  if (!hasOnlyAllowedKeys(input, PRODUCT_FIELD_KEYS)) return { ok: false, error: 'unknown_field' };
  // New products may never carry a reserved (TEST/PRUEBA) category.
  return parseProductFields(input, { rejectReservedCategory: true });
}

export type ProductUpdateInput = ProductFieldsInput & { id: string; expectedUpdatedAt: string };

const PRODUCT_UPDATE_FIELD_KEYS = [...PRODUCT_FIELD_KEYS, 'id', 'expectedUpdatedAt'] as const;

export function parseUpdateProductPayload(value: unknown): ValidationResult<ProductUpdateInput> {
  const input = asObject(value);
  if (!input) return { ok: false, error: 'invalid_payload' };
  if (!hasOnlyAllowedKeys(input, PRODUCT_UPDATE_FIELD_KEYS)) return { ok: false, error: 'unknown_field' };

  const id = typeof input.id === 'string' && UUID.test(input.id) ? input.id : null;
  if (!id) return { ok: false, error: 'invalid_id' };

  if (!isValidTimestamp(input.expectedUpdatedAt)) return { ok: false, error: 'invalid_version' };

  // Editing does not reject a reserved category outright (an already-TEST or
  // already-inactive product may keep or receive one); the RPC itself refuses
  // to keep an *active* product in a reserved category.
  const fields = parseProductFields(input, { rejectReservedCategory: false });
  if (!isValid(fields)) return { ok: false, error: fields.error };

  return { ok: true, value: { ...fields.value, id, expectedUpdatedAt: input.expectedUpdatedAt as string } };
}

export type SetActiveProductInput = { id: string; isActive: boolean; expectedUpdatedAt: string };

const SET_ACTIVE_FIELD_KEYS = ['id', 'isActive', 'expectedUpdatedAt'] as const;

export function parseSetActiveProductPayload(value: unknown): ValidationResult<SetActiveProductInput> {
  const input = asObject(value);
  if (!input) return { ok: false, error: 'invalid_payload' };
  if (!hasOnlyAllowedKeys(input, SET_ACTIVE_FIELD_KEYS)) return { ok: false, error: 'unknown_field' };

  const id = typeof input.id === 'string' && UUID.test(input.id) ? input.id : null;
  if (!id) return { ok: false, error: 'invalid_id' };
  if (typeof input.isActive !== 'boolean') return { ok: false, error: 'invalid_is_active' };
  if (!isValidTimestamp(input.expectedUpdatedAt)) return { ok: false, error: 'invalid_version' };

  return { ok: true, value: { id, isActive: input.isActive, expectedUpdatedAt: input.expectedUpdatedAt as string } };
}

// --- Hero / About settings ---------------------------------------------------

export type HeroContentInput = {
  title: string;
  subtitle: string;
  image_url: string;
  primary_cta_text: string;
  primary_cta_link: string;
};

const HERO_VALUE_FIELD_KEYS = ['title', 'subtitle', 'image_url', 'primary_cta_text', 'primary_cta_link'] as const;
const SETTINGS_PAYLOAD_KEYS = ['value', 'expectedUpdatedAt', 'imageAssetId'] as const;

export type SettingsMutationInput<T> = { content: T; expectedUpdatedAt: string | null; imageAssetId: string | null };

function parseExpectedUpdatedAtOrNull(value: unknown): { ok: true; value: string | null } | { ok: false } {
  if (value === null) return { ok: true, value: null };
  return isValidTimestamp(value) ? { ok: true, value } : { ok: false };
}

export function parseHeroContentPayload(value: unknown): ValidationResult<SettingsMutationInput<HeroContentInput>> {
  const outer = asObject(value);
  if (!outer) return { ok: false, error: 'invalid_payload' };
  if (!hasOnlyAllowedKeys(outer, SETTINGS_PAYLOAD_KEYS)) return { ok: false, error: 'unknown_field' };

  const expectedUpdatedAt = parseExpectedUpdatedAtOrNull(outer.expectedUpdatedAt);
  if (!expectedUpdatedAt.ok) return { ok: false, error: 'invalid_version' };
  const imageAssetId = optionalAssetId(outer.imageAssetId);
  if (!imageAssetId.ok) return { ok: false, error: 'invalid_image_asset_id' };

  const input = asObject(outer.value);
  if (!input) return { ok: false, error: 'invalid_payload' };
  if (!hasOnlyAllowedKeys(input, HERO_VALUE_FIELD_KEYS)) return { ok: false, error: 'unknown_field' };

  const title = requiredText(input.title, MAX_NAME);
  if (!title) return { ok: false, error: 'invalid_title' };
  const subtitle = optionalText(input.subtitle, MAX_HERO_SUBTITLE);
  if (subtitle === null) return { ok: false, error: 'invalid_subtitle' };
  // When a fresh upload is attached, the server overwrites image_url with the
  // asset's canonical secure_url, so the client-submitted value is not required.
  const imageUrl = imageAssetId.value ? (typeof input.image_url === 'string' ? input.image_url.slice(0, MAX_IMAGE_URL) : '') : requiredImageUrl(input.image_url);
  if (!imageAssetId.value && !imageUrl) return { ok: false, error: 'invalid_image_url' };
  const ctaText = requiredText(input.primary_cta_text, MAX_CTA_TEXT);
  if (!ctaText) return { ok: false, error: 'invalid_cta_text' };
  const ctaLink = requiredText(input.primary_cta_link, MAX_CTA_LINK);
  if (!ctaLink || !isSafeCtaLink(ctaLink)) return { ok: false, error: 'invalid_cta_link' };

  return {
    ok: true,
    value: {
      content: { title, subtitle, image_url: imageUrl ?? '', primary_cta_text: ctaText, primary_cta_link: ctaLink },
      expectedUpdatedAt: expectedUpdatedAt.value,
      imageAssetId: imageAssetId.value,
    },
  };
}

export type AboutMetricInput = { id: string; value: string; label: string };
export type AboutContentInput = { image: string; title: string; description: string; metrics: AboutMetricInput[] };

const ABOUT_VALUE_FIELD_KEYS = ['image', 'title', 'description', 'metrics'] as const;
const ABOUT_METRIC_FIELD_KEYS = ['id', 'value', 'label'] as const;
const METRIC_ID_PATTERN = /^[a-z0-9-]{1,40}$/i;

function parseAboutMetric(value: unknown): AboutMetricInput | null {
  const input = asObject(value);
  if (!input) return null;
  if (!hasOnlyAllowedKeys(input, ABOUT_METRIC_FIELD_KEYS)) return null;
  const id = typeof input.id === 'string' && METRIC_ID_PATTERN.test(input.id) ? input.id : null;
  if (!id) return null;
  const metricValue = requiredText(input.value, MAX_METRIC_VALUE);
  if (!metricValue) return null;
  const label = requiredText(input.label, MAX_METRIC_LABEL);
  if (!label) return null;
  return { id, value: metricValue, label };
}

export function parseAboutContentPayload(value: unknown): ValidationResult<SettingsMutationInput<AboutContentInput>> {
  const outer = asObject(value);
  if (!outer) return { ok: false, error: 'invalid_payload' };
  if (!hasOnlyAllowedKeys(outer, SETTINGS_PAYLOAD_KEYS)) return { ok: false, error: 'unknown_field' };

  const expectedUpdatedAt = parseExpectedUpdatedAtOrNull(outer.expectedUpdatedAt);
  if (!expectedUpdatedAt.ok) return { ok: false, error: 'invalid_version' };
  const imageAssetId = optionalAssetId(outer.imageAssetId);
  if (!imageAssetId.ok) return { ok: false, error: 'invalid_image_asset_id' };

  const input = asObject(outer.value);
  if (!input) return { ok: false, error: 'invalid_payload' };
  if (!hasOnlyAllowedKeys(input, ABOUT_VALUE_FIELD_KEYS)) return { ok: false, error: 'unknown_field' };

  // When a fresh upload is attached, the server overwrites image with the
  // asset's canonical secure_url, so the client-submitted value is not required.
  const image = imageAssetId.value ? (typeof input.image === 'string' ? input.image.slice(0, MAX_IMAGE_URL) : '') : requiredImageUrl(input.image);
  if (!imageAssetId.value && !image) return { ok: false, error: 'invalid_image_url' };
  const title = requiredText(input.title, MAX_NAME);
  if (!title) return { ok: false, error: 'invalid_title' };
  const description = requiredText(input.description, MAX_ABOUT_DESCRIPTION);
  if (!description) return { ok: false, error: 'invalid_description' };

  if (!Array.isArray(input.metrics) || input.metrics.length > MAX_METRICS) return { ok: false, error: 'invalid_metrics' };
  const metrics: AboutMetricInput[] = [];
  for (const raw of input.metrics) {
    const metric = parseAboutMetric(raw);
    if (!metric) return { ok: false, error: 'invalid_metrics' };
    metrics.push(metric);
  }

  return {
    ok: true,
    value: { content: { image: image ?? '', title, description, metrics }, expectedUpdatedAt: expectedUpdatedAt.value, imageAssetId: imageAssetId.value },
  };
}
