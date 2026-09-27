import assert from 'node:assert/strict';
import test from 'node:test';

import {
  normalizeAboutContent,
  normalizeCatalogSectionContent,
  normalizeFeaturedSectionContent,
  normalizeHeroContent,
} from '../../src/services/cms.ts';
import { defaultLandingContent } from '../../src/lib/defaultContent.ts';
import { DEFAULT_FRAMING } from '../../src/lib/imageFraming.ts';

// --- Featured/Catalog section copy (ADMIN-02E) ------------------------------
// Their fallback is exactly the copy that used to be hardcoded in
// FeaturedProductsSection/CatalogCtaSection, so a missing document never
// shows a different, unexpected value -- only ever the same text as before,
// until an admin explicitly edits it.

test('normalizeFeaturedSectionContent falls back to the pre-ADMIN-02E hardcoded copy when there is no document yet', () => {
  assert.deepEqual(normalizeFeaturedSectionContent(undefined), defaultLandingContent.featuredSection);
  assert.deepEqual(normalizeFeaturedSectionContent(null), defaultLandingContent.featuredSection);
  assert.deepEqual(normalizeFeaturedSectionContent('not-an-object'), defaultLandingContent.featuredSection);
});

test('normalizeFeaturedSectionContent reads a real saved document as-is', () => {
  const saved = { title: 'Nuestros favoritos', subtitle: 'Seleccionados por el equipo.' };
  assert.deepEqual(normalizeFeaturedSectionContent(saved), saved);
});

test('normalizeCatalogSectionContent falls back to the pre-ADMIN-02E hardcoded copy when there is no document yet', () => {
  assert.deepEqual(normalizeCatalogSectionContent(undefined), defaultLandingContent.catalogSection);
});

test('normalizeCatalogSectionContent reads a real saved document as-is', () => {
  const saved = { title: 'Mirá todo el catálogo', subtitle: 'Más de 50 productos disponibles.' };
  assert.deepEqual(normalizeCatalogSectionContent(saved), saved);
});

// --- Hero/About image framing -----------------------------------------------

test('normalizeHeroContent defaults image_framing to centered/fill/normal-zoom when absent', () => {
  const content = normalizeHeroContent({ title: 'Hola', image_url: 'https://x.test/a.jpg' });
  assert.deepEqual(content?.image_framing, DEFAULT_FRAMING);
});

test('normalizeHeroContent preserves a real saved framing', () => {
  const framing = { mode: 'contain' as const, focalX: 0.2, focalY: 0.8, zoom: 1.4 };
  const content = normalizeHeroContent({ title: 'Hola', image_url: 'https://x.test/a.jpg', image_framing: framing });
  assert.deepEqual(content?.image_framing, framing);
});

// --- About content (now normalized defensively, like Hero) ------------------

test('normalizeAboutContent returns null for a non-object value, same contract as normalizeHeroContent', () => {
  assert.equal(normalizeAboutContent(undefined), null);
  assert.equal(normalizeAboutContent('not-an-object'), null);
});

test('normalizeAboutContent defaults missing metrics to the seeded defaults, not an empty array', () => {
  const content = normalizeAboutContent({ title: 'Nosotros', description: 'desc' });
  assert.deepEqual(content?.metrics.map((metric) => metric.id), defaultLandingContent.about.metrics.map((metric) => metric.id));
});

test('normalizeAboutContent preserves a real saved metrics array, including deliberately empty fields', () => {
  const saved = {
    image: 'https://x.test/about.jpg',
    title: 'Nosotros',
    description: 'desc',
    metrics: [
      { id: 'metric-1', value: '', label: '' },
      { id: 'metric-2', value: '+10', label: 'años' },
    ],
  };
  assert.deepEqual(normalizeAboutContent(saved)?.metrics, saved.metrics);
});

test('normalizeAboutContent defaults image_framing to centered/fill/normal-zoom when absent', () => {
  const content = normalizeAboutContent({ title: 'Nosotros', description: 'desc', image: 'https://x.test/about.jpg' });
  assert.deepEqual(content?.image_framing, DEFAULT_FRAMING);
});
