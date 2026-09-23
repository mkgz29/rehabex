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

test('unsigned browser upload is absent and the existing image URL remains visible', () => {
  const sourceRoot = join(process.cwd(), 'src');
  const runtimeSource = runtimeFiles(sourceRoot).map((path) => readFileSync(path, 'utf8')).join('\n');
  const existingUrl = 'https://images.example.test/existing.jpg';
  const markup = renderToStaticMarkup(React.createElement(ImageField, {
    label: 'Imagen existente',
    value: existingUrl,
    onChange: () => undefined,
  }));

  assert.equal(existsSync(join(sourceRoot, 'services', 'cloudinary.ts')), false);
  assert.doesNotMatch(runtimeSource, /upload_preset|api\.cloudinary\.com\/v1_1|new FormData\s*\(/i);
  assert.match(markup, /value="https:\/\/images\.example\.test\/existing\.jpg"/);
  assert.match(markup, /src="https:\/\/images\.example\.test\/existing\.jpg"/);
  assert.match(markup, /disabled=""/);
  assert.match(markup, /flujo seguro pendiente/);
  assert.doesNotMatch(markup, /required=""/);
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
