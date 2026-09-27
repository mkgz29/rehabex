import assert from 'node:assert/strict';
import test from 'node:test';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { ProductGalleryField } from '../../src/admin/components/ProductGalleryField.tsx';
import type { GalleryDraftItem } from '../../src/admin/catalog/productGallery.ts';

(globalThis as typeof globalThis & { React: typeof React }).React = React;

function item(mediaAssetId: string, isPrimary = false): GalleryDraftItem {
  return { mediaAssetId, url: `https://images.example.test/${mediaAssetId}.jpg`, isPrimary };
}

function render(items: GalleryDraftItem[], persistedIds: Set<string> = new Set()) {
  return renderToStaticMarkup(React.createElement(ProductGalleryField, { items, onChange: () => undefined, persistedIds }));
}

test('empty gallery: honest empty message, no forbidden vocabulary, still lets you add a first image', () => {
  const markup = render([]);
  assert.match(markup, /Todavía no agregaste ninguna imagen/);
  assert.match(markup, /Agregar imagen/i);
  assertNoForbiddenVocabulary(markup);
});

test('one image: shown as "Imagen 1 de 5", marked as the main image, with plain-language actions', () => {
  const markup = render([item('a', true)]);
  assert.match(markup, /Imagen 1 de 5/);
  assert.match(markup, /Imagen principal/);
  assert.match(markup, /Cambiar imagen/);
  assert.match(markup, /Quitar imagen/);
  assert.match(markup, /Mover antes/);
  assert.match(markup, /Mover después/);
  // The only image is already primary: no redundant "usar como principal" for it.
  assert.doesNotMatch(markup, /Usar como principal/);
  assertNoForbiddenVocabulary(markup);
});

test('multiple images: a non-primary image offers "Usar como principal"', () => {
  const markup = render([item('a', true), item('b', false)]);
  assert.match(markup, /Usar como principal/);
  assert.match(markup, /Imagen 1 de 5/);
  assert.match(markup, /Imagen 2 de 5/);
});

test('five images: the add control is replaced by a plain-language limit message', () => {
  const items = Array.from({ length: 5 }, (_, i) => item(`id-${i}`, i === 0));
  const markup = render(items);
  assert.match(markup, /máximo de 5 imágenes/i);
  assertNoForbiddenVocabulary(markup);
});

test('touch targets and no forbidden vocabulary hold across every state', () => {
  const markup = render([item('a', true), item('b')]);
  assert.match(markup, /min-h-11/);
  assertNoForbiddenVocabulary(markup);
});

function assertNoForbiddenVocabulary(markup: string) {
  const forbidden = ['asset', 'media', 'pipeline', 'Cloudinary', 'Supabase', 'UUID', 'RPC', 'endpoint', 'payload', 'public_id', 'orphan'];
  for (const word of forbidden) {
    assert.doesNotMatch(markup, new RegExp(`\\b${word}\\b`, 'i'), `found forbidden term "${word}"`);
  }
}
