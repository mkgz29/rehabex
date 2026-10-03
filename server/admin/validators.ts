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
const MAX_SUPPORT_NAME = 160;
const MAX_SUPPORT_EMAIL = 254;
const MAX_SUPPORT_PHONE = 40;
const MAX_SUPPORT_SUBJECT = 200;
const MAX_SUPPORT_MESSAGE = 4000;
const MAX_SUPPORT_NOTES = 4000;

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const SUPPORT_STATUSES = ['open', 'answered', 'resolved'] as const;

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

// --- Image framing (ADMIN-02E) -----------------------------------------------
// Shared by Hero/About settings and each product gallery item: where an
// image is positioned in the box that shows it. Mirrors src/lib/imageFraming.ts's
// shape and bounds so client and server never disagree on what is valid.

export type ImageFramingInput = { mode: 'fill' | 'contain'; focalX: number; focalY: number; zoom: number };

function isUnitFraction(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
}

function isValidZoom(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 1 && value <= 3;
}

/** Absent is fine (defaults apply downstream); present must be a fully well-formed object. */
function optionalFraming(value: unknown): { ok: true; value: ImageFramingInput | null } | { ok: false } {
  if (value === undefined || value === null) return { ok: true, value: null };
  const input = asObject(value);
  if (!input) return { ok: false };
  if (!hasOnlyAllowedKeys(input, ['mode', 'focalX', 'focalY', 'zoom'])) return { ok: false };
  if (input.mode !== 'fill' && input.mode !== 'contain') return { ok: false };
  if (!isUnitFraction(input.focalX) || !isUnitFraction(input.focalY) || !isValidZoom(input.zoom)) return { ok: false };
  return { ok: true, value: { mode: input.mode, focalX: input.focalX, focalY: input.focalY, zoom: input.zoom } };
}

// --- Products ---------------------------------------------------------------

/** Absent/null is fine (no new upload this edit); if present it must be a UUID naming a media asset. Still used by the Hero/About settings RPCs, which keep their single-image shape (only products moved to a gallery). */
function optionalAssetId(value: unknown): { ok: true; value: string | null } | { ok: false } {
  if (value === undefined || value === null) return { ok: true, value: null };
  return typeof value === 'string' && UUID.test(value) ? { ok: true, value } : { ok: false };
}

export type GalleryItemInput =
  | { mediaAssetId: string; isPrimary: boolean; framing: ImageFramingInput | null }
  | { legacyUrl: string; isPrimary: boolean; framing: ImageFramingInput | null };

export const MAX_GALLERY_IMAGES = 5;

/**
 * Mirrors the checks admin_sync_product_gallery repeats server-side (the RPC
 * is the actual security boundary); this pass exists only to reject an
 * obviously-malformed gallery with a specific, friendly message before ever
 * reaching the database.
 *
 * Each entry is either a media_assets-backed image (mediaAssetId) or a
 * legacy image carried over from before the gallery existed (legacyUrl,
 * RELEASE-ADMIN-02-PREFLIGHT backfill) -- never both. This pass only checks
 * shape; the RPC is what actually verifies a legacyUrl already exists as a
 * legacy row on that exact product, which is what stops a client from
 * fabricating an arbitrary image by claiming it is "legacy".
 */
function parseGallery(value: unknown): ValidationResult<GalleryItemInput[]> {
  if (value === undefined || value === null) return { ok: true, value: [] };
  if (!Array.isArray(value)) return { ok: false, error: 'invalid_gallery' };
  if (value.length > MAX_GALLERY_IMAGES) return { ok: false, error: 'too_many_images' };

  const items: GalleryItemInput[] = [];
  const seenAssetIds = new Set<string>();
  const seenLegacyUrls = new Set<string>();
  let primaryCount = 0;

  for (const raw of value) {
    const entry = asObject(raw);
    if (!entry) return { ok: false, error: 'invalid_gallery' };

    const hasAssetId = 'mediaAssetId' in entry;
    const hasLegacyUrl = 'legacyUrl' in entry;
    if (hasAssetId === hasLegacyUrl) return { ok: false, error: 'invalid_gallery' };
    if (!hasOnlyAllowedKeys(entry, hasAssetId ? ['mediaAssetId', 'isPrimary', 'framing'] : ['legacyUrl', 'isPrimary', 'framing'])) {
      return { ok: false, error: 'unknown_field' };
    }

    if (typeof entry.isPrimary !== 'boolean') return { ok: false, error: 'invalid_gallery' };
    if (entry.isPrimary) primaryCount += 1;

    const framing = optionalFraming(entry.framing);
    if (!framing.ok) return { ok: false, error: 'invalid_gallery' };

    if (hasAssetId) {
      const mediaAssetId = entry.mediaAssetId;
      if (typeof mediaAssetId !== 'string' || !UUID.test(mediaAssetId)) return { ok: false, error: 'invalid_gallery' };
      if (seenAssetIds.has(mediaAssetId)) return { ok: false, error: 'duplicate_image' };
      seenAssetIds.add(mediaAssetId);
      items.push({ mediaAssetId, isPrimary: entry.isPrimary, framing: framing.value });
    } else {
      const legacyUrl = entry.legacyUrl;
      if (typeof legacyUrl !== 'string' || legacyUrl.length > MAX_IMAGE_URL || !isHttpsUrl(legacyUrl)) {
        return { ok: false, error: 'invalid_gallery' };
      }
      if (seenLegacyUrls.has(legacyUrl)) return { ok: false, error: 'duplicate_image' };
      seenLegacyUrls.add(legacyUrl);
      items.push({ legacyUrl, isPrimary: entry.isPrimary, framing: framing.value });
    }
  }

  if (items.length > 0 && primaryCount !== 1) return { ok: false, error: 'invalid_primary' };

  return { ok: true, value: items };
}

export type ProductFieldsInput = {
  name: string;
  description: string;
  category: string;
  price: number;
  gallery: GalleryItemInput[];
  isFeatured: boolean;
  displayOrder: number;
  isActive: boolean;
};

const PRODUCT_FIELD_KEYS = ['name', 'description', 'category', 'price', 'gallery', 'isFeatured', 'displayOrder', 'isActive'] as const;

function parseProductFields(input: Record<string, unknown>, options: { rejectReservedCategory: boolean }): ValidationResult<ProductFieldsInput> {
  const name = requiredText(input.name, MAX_NAME);
  if (!name) return { ok: false, error: 'invalid_name' };

  const category = requiredText(input.category, MAX_CATEGORY);
  if (!category) return { ok: false, error: 'invalid_category' };
  if (options.rejectReservedCategory && isReservedCategory(category)) return { ok: false, error: 'reserved_category' };

  if (!isValidPrice(input.price)) return { ok: false, error: 'invalid_price' };

  const description = optionalText(input.description, MAX_DESCRIPTION);
  if (description === null) return { ok: false, error: 'invalid_description' };

  const gallery = parseGallery(input.gallery);
  if (!isValid(gallery)) return { ok: false, error: gallery.error };

  if (typeof input.isFeatured !== 'boolean') return { ok: false, error: 'invalid_is_featured' };
  if (!isNonNegativeInt(input.displayOrder, MAX_DISPLAY_ORDER)) return { ok: false, error: 'invalid_display_order' };
  if (typeof input.isActive !== 'boolean') return { ok: false, error: 'invalid_is_active' };

  return {
    ok: true,
    value: {
      name,
      description,
      category,
      price: input.price as number,
      gallery: gallery.value,
      isFeatured: input.isFeatured,
      displayOrder: input.displayOrder as number,
      isActive: input.isActive,
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
  image_framing: ImageFramingInput | null;
  primary_cta_text: string;
  primary_cta_link: string;
};

const HERO_VALUE_FIELD_KEYS = ['title', 'subtitle', 'image_url', 'image_framing', 'primary_cta_text', 'primary_cta_link'] as const;
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
  const framing = optionalFraming(input.image_framing);
  if (!framing.ok) return { ok: false, error: 'invalid_image_framing' };

  return {
    ok: true,
    value: {
      content: { title, subtitle, image_url: imageUrl ?? '', image_framing: framing.value, primary_cta_text: ctaText, primary_cta_link: ctaLink },
      expectedUpdatedAt: expectedUpdatedAt.value,
      imageAssetId: imageAssetId.value,
    },
  };
}

export type AboutMetricInput = { id: string; value: string; label: string };
export type AboutContentInput = {
  image: string;
  image_framing: ImageFramingInput | null;
  title: string;
  description: string;
  metrics: AboutMetricInput[];
};

const ABOUT_VALUE_FIELD_KEYS = ['image', 'image_framing', 'title', 'description', 'metrics'] as const;
const ABOUT_METRIC_FIELD_KEYS = ['id', 'value', 'label'] as const;
const METRIC_ID_PATTERN = /^[a-z0-9-]{1,40}$/i;

// A metric's value/label may each be empty on purpose (ADMIN-02E: clearing
// one hides just that metric publicly, clearing both hides the whole "Datos
// destacados" block) -- only the id is required, so the empty state can be
// saved at all instead of being rejected as incomplete.
function parseAboutMetric(value: unknown): AboutMetricInput | null {
  const input = asObject(value);
  if (!input) return null;
  if (!hasOnlyAllowedKeys(input, ABOUT_METRIC_FIELD_KEYS)) return null;
  const id = typeof input.id === 'string' && METRIC_ID_PATTERN.test(input.id) ? input.id : null;
  if (!id) return null;
  const metricValue = optionalText(input.value, MAX_METRIC_VALUE);
  if (metricValue === null) return null;
  const label = optionalText(input.label, MAX_METRIC_LABEL);
  if (label === null) return null;
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
  const framing = optionalFraming(input.image_framing);
  if (!framing.ok) return { ok: false, error: 'invalid_image_framing' };

  if (!Array.isArray(input.metrics) || input.metrics.length > MAX_METRICS) return { ok: false, error: 'invalid_metrics' };
  const metrics: AboutMetricInput[] = [];
  for (const raw of input.metrics) {
    const metric = parseAboutMetric(raw);
    if (!metric) return { ok: false, error: 'invalid_metrics' };
    metrics.push(metric);
  }

  return {
    ok: true,
    value: {
      content: { image: image ?? '', image_framing: framing.value, title, description, metrics },
      expectedUpdatedAt: expectedUpdatedAt.value,
      imageAssetId: imageAssetId.value,
    },
  };
}

// --- Featured/Catalog section copy (ADMIN-02E) -------------------------------

export type SectionCopyInput = { title: string; subtitle: string };
export type SectionCopyMutationInput = { content: SectionCopyInput; expectedUpdatedAt: string | null };

const SECTION_COPY_PAYLOAD_KEYS = ['value', 'expectedUpdatedAt'] as const;
const SECTION_COPY_VALUE_KEYS = ['title', 'subtitle'] as const;
const MAX_SECTION_TITLE = 200;
const MAX_SECTION_SUBTITLE = 300;

function parseSectionCopyPayload(value: unknown): ValidationResult<SectionCopyMutationInput> {
  const outer = asObject(value);
  if (!outer) return { ok: false, error: 'invalid_payload' };
  if (!hasOnlyAllowedKeys(outer, SECTION_COPY_PAYLOAD_KEYS)) return { ok: false, error: 'unknown_field' };

  const expectedUpdatedAt = parseExpectedUpdatedAtOrNull(outer.expectedUpdatedAt);
  if (!expectedUpdatedAt.ok) return { ok: false, error: 'invalid_version' };

  const input = asObject(outer.value);
  if (!input) return { ok: false, error: 'invalid_payload' };
  if (!hasOnlyAllowedKeys(input, SECTION_COPY_VALUE_KEYS)) return { ok: false, error: 'unknown_field' };

  const title = requiredText(input.title, MAX_SECTION_TITLE);
  if (!title) return { ok: false, error: 'invalid_title' };
  const subtitle = optionalText(input.subtitle, MAX_SECTION_SUBTITLE);
  if (subtitle === null) return { ok: false, error: 'invalid_subtitle' };

  return { ok: true, value: { content: { title, subtitle }, expectedUpdatedAt: expectedUpdatedAt.value } };
}

export function parseFeaturedSectionContentPayload(value: unknown): ValidationResult<SectionCopyMutationInput> {
  return parseSectionCopyPayload(value);
}

export function parseCatalogSectionContentPayload(value: unknown): ValidationResult<SectionCopyMutationInput> {
  return parseSectionCopyPayload(value);
}

// --- Featured products curation (ADMIN-02E) ----------------------------------
// Bulk, atomic selection + order for the public "Productos destacados"
// section. products.is_featured/display_order stay the only source of
// truth; the RPC (not this pass) rejects marking a hidden or TEST/PRUEBA
// product featured, since that needs a fresh read of the product row.

export type FeaturedProductItemInput = { id: string; isFeatured: boolean; displayOrder: number };

const FEATURED_PRODUCTS_PAYLOAD_KEYS = ['items'] as const;
const FEATURED_PRODUCT_ITEM_KEYS = ['id', 'isFeatured', 'displayOrder'] as const;
const MAX_FEATURED_ITEMS = 100;

export function parseFeaturedProductsPayload(value: unknown): ValidationResult<FeaturedProductItemInput[]> {
  const outer = asObject(value);
  if (!outer) return { ok: false, error: 'invalid_payload' };
  if (!hasOnlyAllowedKeys(outer, FEATURED_PRODUCTS_PAYLOAD_KEYS)) return { ok: false, error: 'unknown_field' };
  if (!Array.isArray(outer.items) || outer.items.length > MAX_FEATURED_ITEMS) return { ok: false, error: 'invalid_request' };

  const items: FeaturedProductItemInput[] = [];
  const seen = new Set<string>();
  for (const raw of outer.items) {
    const entry = asObject(raw);
    if (!entry) return { ok: false, error: 'invalid_request' };
    if (!hasOnlyAllowedKeys(entry, FEATURED_PRODUCT_ITEM_KEYS)) return { ok: false, error: 'unknown_field' };

    const id = typeof entry.id === 'string' && UUID.test(entry.id) ? entry.id : null;
    if (!id) return { ok: false, error: 'invalid_request' };
    if (seen.has(id)) return { ok: false, error: 'duplicate_product' };
    seen.add(id);

    if (typeof entry.isFeatured !== 'boolean') return { ok: false, error: 'invalid_request' };
    if (!isNonNegativeInt(entry.displayOrder, MAX_DISPLAY_ORDER)) return { ok: false, error: 'invalid_request' };

    items.push({ id, isFeatured: entry.isFeatured, displayOrder: entry.displayOrder as number });
  }

  return { ok: true, value: items };
}

// --- Support requests (ADMIN-03A) --------------------------------------------
// v1 is admin-only: staff log a case themselves when a customer reaches out
// by phone/email/WhatsApp. There is no public submission endpoint, so every
// one of these payloads is only ever reachable through the admin boundary.

export type CreateSupportRequestInput = {
  customerName: string;
  customerEmail: string;
  customerPhone: string | null;
  subject: string | null;
  message: string;
  orderId: string | null;
};

const CREATE_SUPPORT_REQUEST_KEYS = ['customerName', 'customerEmail', 'customerPhone', 'subject', 'message', 'orderId'] as const;

function requiredEmail(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= MAX_SUPPORT_EMAIL && EMAIL_PATTERN.test(trimmed) ? trimmed : null;
}

function optionalPhone(value: unknown): string | null | undefined {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (trimmed === '') return null;
  return trimmed.length <= MAX_SUPPORT_PHONE && !/[<>]/.test(trimmed) ? trimmed : undefined;
}

/** Absent, empty, or whitespace-only all become null (no subject); otherwise bounded and sanitized like any other optional text field. */
function optionalSubject(value: unknown): string | null | undefined {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (trimmed === '') return null;
  return trimmed.length <= MAX_SUPPORT_SUBJECT && !/[<>]/.test(trimmed) ? trimmed : undefined;
}

function optionalOrderId(value: unknown): string | null | undefined {
  if (value === undefined || value === null) return null;
  return typeof value === 'string' && UUID.test(value) ? value : undefined;
}

export function parseCreateSupportRequestPayload(value: unknown): ValidationResult<CreateSupportRequestInput> {
  const input = asObject(value);
  if (!input) return { ok: false, error: 'invalid_payload' };
  if (!hasOnlyAllowedKeys(input, CREATE_SUPPORT_REQUEST_KEYS)) return { ok: false, error: 'unknown_field' };

  const customerName = requiredText(input.customerName, MAX_SUPPORT_NAME);
  if (!customerName) return { ok: false, error: 'invalid_customer_name' };

  const customerEmail = requiredEmail(input.customerEmail);
  if (!customerEmail) return { ok: false, error: 'invalid_customer_email' };

  const customerPhone = optionalPhone(input.customerPhone);
  if (customerPhone === undefined) return { ok: false, error: 'invalid_customer_phone' };

  const subject = optionalSubject(input.subject);
  if (subject === undefined) return { ok: false, error: 'invalid_subject' };

  const message = requiredText(input.message, MAX_SUPPORT_MESSAGE);
  if (!message) return { ok: false, error: 'invalid_message' };

  const orderId = optionalOrderId(input.orderId);
  if (orderId === undefined) return { ok: false, error: 'invalid_order_id' };

  return { ok: true, value: { customerName, customerEmail, customerPhone, subject, message, orderId } };
}

export type UpdateSupportRequestStatusInput = { id: string; status: (typeof SUPPORT_STATUSES)[number]; expectedUpdatedAt: string };

const UPDATE_SUPPORT_REQUEST_STATUS_KEYS = ['id', 'status', 'expectedUpdatedAt'] as const;

export function parseUpdateSupportRequestStatusPayload(value: unknown): ValidationResult<UpdateSupportRequestStatusInput> {
  const input = asObject(value);
  if (!input) return { ok: false, error: 'invalid_payload' };
  if (!hasOnlyAllowedKeys(input, UPDATE_SUPPORT_REQUEST_STATUS_KEYS)) return { ok: false, error: 'unknown_field' };

  const id = typeof input.id === 'string' && UUID.test(input.id) ? input.id : null;
  if (!id) return { ok: false, error: 'invalid_id' };

  if (typeof input.status !== 'string' || !SUPPORT_STATUSES.includes(input.status as (typeof SUPPORT_STATUSES)[number])) {
    return { ok: false, error: 'invalid_status' };
  }

  if (!isValidTimestamp(input.expectedUpdatedAt)) return { ok: false, error: 'invalid_version' };

  return { ok: true, value: { id, status: input.status as (typeof SUPPORT_STATUSES)[number], expectedUpdatedAt: input.expectedUpdatedAt as string } };
}

export type UpdateSupportRequestNotesInput = { id: string; internalNotes: string | null; expectedUpdatedAt: string };

const UPDATE_SUPPORT_REQUEST_NOTES_KEYS = ['id', 'internalNotes', 'expectedUpdatedAt'] as const;

export function parseUpdateSupportRequestNotesPayload(value: unknown): ValidationResult<UpdateSupportRequestNotesInput> {
  const input = asObject(value);
  if (!input) return { ok: false, error: 'invalid_payload' };
  if (!hasOnlyAllowedKeys(input, UPDATE_SUPPORT_REQUEST_NOTES_KEYS)) return { ok: false, error: 'unknown_field' };

  const id = typeof input.id === 'string' && UUID.test(input.id) ? input.id : null;
  if (!id) return { ok: false, error: 'invalid_id' };

  const internalNotes = optionalText(input.internalNotes, MAX_SUPPORT_NOTES);
  if (internalNotes === null) return { ok: false, error: 'invalid_internal_notes' };

  if (!isValidTimestamp(input.expectedUpdatedAt)) return { ok: false, error: 'invalid_version' };

  return { ok: true, value: { id, internalNotes: internalNotes || null, expectedUpdatedAt: input.expectedUpdatedAt as string } };
}

export type ListSupportRequestsInput = { status: (typeof SUPPORT_STATUSES)[number] | null };

const LIST_SUPPORT_REQUESTS_KEYS = ['status'] as const;

export function parseListSupportRequestsPayload(value: unknown): ValidationResult<ListSupportRequestsInput> {
  const input = asObject(value) ?? {};
  if (!hasOnlyAllowedKeys(input, LIST_SUPPORT_REQUESTS_KEYS)) return { ok: false, error: 'unknown_field' };

  if (input.status === undefined || input.status === null) return { ok: true, value: { status: null } };
  if (typeof input.status !== 'string' || !SUPPORT_STATUSES.includes(input.status as (typeof SUPPORT_STATUSES)[number])) {
    return { ok: false, error: 'invalid_status' };
  }

  return { ok: true, value: { status: input.status as (typeof SUPPORT_STATUSES)[number] } };
}

export type GetSupportRequestInput = { id: string };

const GET_SUPPORT_REQUEST_KEYS = ['id'] as const;

export function parseGetSupportRequestPayload(value: unknown): ValidationResult<GetSupportRequestInput> {
  const input = asObject(value);
  if (!input) return { ok: false, error: 'invalid_payload' };
  if (!hasOnlyAllowedKeys(input, GET_SUPPORT_REQUEST_KEYS)) return { ok: false, error: 'unknown_field' };

  const id = typeof input.id === 'string' && UUID.test(input.id) ? input.id : null;
  if (!id) return { ok: false, error: 'invalid_id' };

  return { ok: true, value: { id } };
}
