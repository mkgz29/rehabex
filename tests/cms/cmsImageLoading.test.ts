import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

import { defaultLandingContent } from '../../src/lib/defaultContent.ts';
import { getLandingContent, normalizeHeroContent } from '../../src/services/cms.ts';
import { resolveMediaSlotState } from '../../src/components/media/mediaSlotState.ts';

test('defaultLandingContent carries no editorial photograph, only textual defaults', () => {
  assert.equal(defaultLandingContent.hero.image_url, '');
  assert.equal(defaultLandingContent.about.image, '');
  assert.ok(defaultLandingContent.hero.title.length > 0);
  assert.ok(Boolean(defaultLandingContent.hero.subtitle && defaultLandingContent.hero.subtitle.length > 0));
  assert.ok(defaultLandingContent.hero.primary_cta_text.length > 0);
  assert.ok(defaultLandingContent.hero.primary_cta_link.length > 0);
  assert.ok(defaultLandingContent.about.title.length > 0);
  assert.ok(defaultLandingContent.about.description.length > 0);
  assert.equal(defaultLandingContent.about.metrics.length > 0, true);
});

test('normalizeHeroContent never substitutes a stock photo for a missing, empty, blank, or invalid persisted image', () => {
  assert.equal(normalizeHeroContent(null), null);
  assert.equal(normalizeHeroContent('not-an-object'), null);

  assert.equal(normalizeHeroContent({ title: 'x' })?.image_url, '');
  assert.equal(normalizeHeroContent({ image_url: null })?.image_url, '');
  assert.equal(normalizeHeroContent({ image_url: '' })?.image_url, '');
  assert.equal(normalizeHeroContent({ image_url: '   ' })?.image_url, '');
  assert.equal(normalizeHeroContent({ image_url: 42 })?.image_url, '');

  const validUrl = 'https://res.cloudinary.com/demo/image/upload/v1/hero.jpg';
  assert.equal(normalizeHeroContent({ image_url: validUrl })?.image_url, validUrl);

  const validCamelCaseUrl = 'https://res.cloudinary.com/demo/image/upload/v1/hero2.jpg';
  assert.equal(normalizeHeroContent({ imageUrl: validCamelCaseUrl })?.image_url, validCamelCaseUrl);
});

test('resolveMediaSlotState: loading always wins, even over a valid persisted url', () => {
  assert.equal(resolveMediaSlotState({ isLoading: true, url: '', failed: false }), 'loading');
  assert.equal(resolveMediaSlotState({ isLoading: true, url: 'https://x/y.jpg', failed: false }), 'loading');
  assert.equal(resolveMediaSlotState({ isLoading: true, url: 'https://x/y.jpg', failed: true }), 'loading');
});

test('resolveMediaSlotState: once resolved, empty/ready/error are correct and mutually exclusive', () => {
  assert.equal(resolveMediaSlotState({ isLoading: false, url: '', failed: false }), 'empty');
  assert.equal(resolveMediaSlotState({ isLoading: false, url: 'https://x/y.jpg', failed: false }), 'ready');
  assert.equal(resolveMediaSlotState({ isLoading: false, url: 'https://x/y.jpg', failed: true }), 'error');
});

test('with no Supabase configured, the landing content default path exposes no image at all', async () => {
  const content = await getLandingContent();
  assert.equal(content.hero.image_url, '');
  assert.equal(content.about.image, '');
});

test('no runtime source file references the retired editorial Unsplash photograph', () => {
  const sourceRoot = join(process.cwd(), 'src');
  const runtimeSource = runtimeFiles(sourceRoot).map((path) => readFileSync(path, 'utf8')).join('\n');
  assert.doesNotMatch(runtimeSource, /unsplash/i);
});

function runtimeFiles(root: string): string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      return runtimeFiles(path);
    }
    return /\.(ts|tsx)$/.test(entry.name) ? [path] : [];
  });
}
