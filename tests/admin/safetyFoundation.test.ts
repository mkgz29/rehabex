import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';
import { join } from 'node:path';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { ImageField } from '../../src/admin/components/ImageField.tsx';
import { isInternalCategory, isPublicCatalogProduct } from '../../src/lib/catalog.ts';

(globalThis as typeof globalThis & { React: typeof React }).React = React;

test('recognizes internal catalog categories without case or surrounding-space bypasses', () => {
  assert.equal(isInternalCategory('TEST'), true);
  assert.equal(isInternalCategory('test'), true);
  assert.equal(isInternalCategory(' prueba '), true);
  assert.equal(isInternalCategory('PrUeBa'), true);
  assert.equal(isInternalCategory('Ortopedia'), false);
  assert.equal(isInternalCategory('testing'), false);
  assert.equal(isInternalCategory('pretest'), false);
  assert.equal(isInternalCategory(undefined), false);
});

test('publishes only active, non-internal products', () => {
  assert.equal(isPublicCatalogProduct({ active: true, category: 'Ortopedia' }), true);
  assert.equal(isPublicCatalogProduct({ active: false, category: 'Ortopedia' }), false);
  assert.equal(isPublicCatalogProduct({ active: true, category: 'TEST' }), false);
  assert.equal(isPublicCatalogProduct({ active: true, category: ' prueba ' }), false);
});

test('runtime catalog fails closed and contains no demo-product fallback', () => {
  const sourceRoot = join(process.cwd(), 'src');
  const runtimeSource = runtimeFiles(sourceRoot).map((path) => readFileSync(path, 'utf8')).join('\n');
  const landingHook = readFileSync(join(sourceRoot, 'hooks', 'useLandingData.ts'), 'utf8');
  const featuredSection = readFileSync(join(sourceRoot, 'components', 'FeaturedProductsSection.tsx'), 'utf8');
  const storePage = readFileSync(join(sourceRoot, 'pages', 'StorePage.tsx'), 'utf8');

  assert.equal(runtimeSource.includes('defaultProducts'), false);
  assert.match(landingHook, /products:\s*productsResult\.status === 'fulfilled' \? productsResult\.value : \[\]/);
  assert.match(featuredSection, /<ErrorState[^>]+onRetry=/);
  assert.match(featuredSection, /<EmptyState\s*\/>/);
  assert.match(storePage, /<ErrorState[^>]+onRetry=/);
  assert.match(storePage, /<EmptyState\s*\/>/);
});

// ADMIN-01A disabled upload entirely (no signed flow existed yet), so this
// test originally asserted that api.cloudinary.com/v1_1, FormData and the
// upload button were all absent. ADMIN-01C reactivates upload through a
// signed flow (server-authorized, server-verified), so those specific
// mechanics are now intentionally present. What must still hold, forever,
// is that no *unsigned* preset exists and the API secret never reaches
// browser-bundled code; this test asserts that instead.
test('secure signed upload is active: no unsigned preset, no API secret client-side, legacy image still renders', () => {
  const sourceRoot = join(process.cwd(), 'src');
  const runtimeSource = runtimeFiles(sourceRoot).map((path) => readFileSync(path, 'utf8')).join('\n');
  const existingUrl = 'https://images.example.test/existing.jpg';
  const markup = renderToStaticMarkup(React.createElement(ImageField, {
    label: 'Imagen existente',
    value: existingUrl,
    intent: 'product',
    onAssetReady: () => undefined,
  }));

  assert.equal(existsSync(join(sourceRoot, 'services', 'cloudinary.ts')), false);
  assert.doesNotMatch(runtimeSource, /upload_preset/i);
  assert.doesNotMatch(runtimeSource, /CLOUDINARY_API_SECRET/);
  assert.doesNotMatch(runtimeSource, /VITE_CLOUDINARY/i);
  assert.doesNotMatch(markup, /type="url"/);
  assert.match(markup, /type="file"/);
  assert.match(markup, /src="https:\/\/images\.example\.test\/existing\.jpg"/);
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
