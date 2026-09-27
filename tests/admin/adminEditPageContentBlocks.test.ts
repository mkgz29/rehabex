import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { DEFAULT_FRAMING } from '../../src/lib/imageFraming.ts';
import { ImageField } from '../../src/admin/components/ImageField.tsx';
import { ImageFramingDialog, resolveFramingDialogResult } from '../../src/admin/components/ImageFramingDialog.tsx';
import {
  ProductThumbnail,
  productVisibilityLabel,
  toFeaturedDraft,
} from '../../src/admin/components/FeaturedProductsEditor.tsx';
import { AdminEditPagePage, nextOpenSection } from '../../src/admin/pages/AdminEditPagePage.tsx';
import { UnsavedChangesProvider } from '../../src/admin/unsavedChanges/UnsavedChangesContext.tsx';
import type { Product } from '../../src/types/cms.ts';

(globalThis as typeof globalThis & { React: typeof React }).React = React;

function renderEditPage() {
  return renderToStaticMarkup(React.createElement(UnsavedChangesProvider, null, React.createElement(AdminEditPagePage)));
}

function product(overrides: Partial<Product> = {}): Product {
  return {
    id: 'p1',
    name: 'Andador',
    description: '',
    price: 100,
    imageUrl: '',
    category: 'Movilidad',
    featured: false,
    sortOrder: 0,
    active: true,
    ...overrides,
  };
}

test('Editar página starts with exactly five closed section cards and no forms mounted', () => {
  const markup = renderEditPage();
  const titles = ['Portada principal', 'Productos destacados', 'Acerca de Rehabex', 'Datos destacados', 'Catálogo de productos'];
  let previousIndex = -1;
  for (const title of titles) {
    const index = markup.indexOf(title);
    assert.ok(index > previousIndex, `${title} should be present in the requested order`);
    previousIndex = index;
  }
  assert.equal((markup.match(/aria-expanded="false"/g) ?? []).length, 5);
  assert.equal((markup.match(/>Editar<\/button>/g) ?? []).length, 5);
  assert.doesNotMatch(markup, /<form/);
  assert.doesNotMatch(markup, /Cada bloque se guarda por separado/);
});

test('opening another section closes the current one, while rejected discard confirmation keeps it open', () => {
  assert.equal(nextOpenSection(null, 'hero', true), 'hero');
  assert.equal(nextOpenSection('hero', 'about', true), 'about');
  assert.equal(nextOpenSection('hero', 'about', false), 'hero');
  assert.equal(nextOpenSection('hero', 'hero', true), null);
});

test('closed cards expose summaries only, with no advanced controls', () => {
  const markup = renderEditPage();
  assert.match(markup, /Botón:/);
  assert.match(markup, /productos seleccionados/);
  assert.match(markup, /Sin explicación|experiencia/i);
  assert.doesNotMatch(markup, /type="file"/);
  assert.doesNotMatch(markup, /type="range"/);
});

test('an existing image has one preview plus Cambiar imagen and Acomodar imagen actions', () => {
  const markup = renderToStaticMarkup(React.createElement(ImageField, {
    label: 'Imagen de portada',
    value: 'https://images.example.test/hero.jpg',
    intent: 'hero',
    framing: DEFAULT_FRAMING,
    onFramingChange: () => undefined,
    onAssetReady: () => undefined,
  }));
  assert.equal((markup.match(/<img/g) ?? []).length, 1);
  assert.match(markup, />Cambiar imagen</);
  assert.match(markup, />Acomodar imagen</);
  assert.doesNotMatch(markup, /role="dialog"/);
});

test('Acomodar imagen renders a focused accessible dialog using the existing framing editor', () => {
  const markup = renderToStaticMarkup(React.createElement(ImageFramingDialog, {
    open: true,
    url: 'https://images.example.test/hero.jpg',
    framing: DEFAULT_FRAMING,
    onApply: () => undefined,
    onCancel: () => undefined,
  }));
  assert.match(markup, /role="dialog"/);
  assert.match(markup, /aria-modal="true"/);
  assert.match(markup, /role="slider"/);
  assert.match(markup, />Listo</);
  assert.match(markup, />Cancelar</);
  assert.equal((markup.match(/<img/g) ?? []).length, 1);
});

test('Cancel keeps the previous framing while Listo applies the local draft', () => {
  const previous = { ...DEFAULT_FRAMING };
  const draft = { ...DEFAULT_FRAMING, focalX: 0.2, zoom: 1.5 };
  assert.deepEqual(resolveFramingDialogResult(previous, draft, 'cancel'), previous);
  assert.deepEqual(resolveFramingDialogResult(previous, draft, 'apply'), draft);
});

test('new files open the framer after preparation, and Escape follows the cancel path', () => {
  const imageFieldSource = readFileSync(join(process.cwd(), 'src', 'admin', 'components', 'ImageField.tsx'), 'utf8');
  const dialogSource = readFileSync(join(process.cwd(), 'src', 'admin', 'components', 'ImageFramingDialog.tsx'), 'utf8');
  assert.match(imageFieldSource, /setState\(\{ kind: 'uploading', previewUrl, percent: 0 \}\);\s*openFramer\(previewUrl\)/);
  assert.match(dialogSource, /event\.key === 'Escape'[\s\S]*cancelRef\.current\(\)/);
  assert.match(imageFieldSource, /onFramingChange\?\.\(nextFraming\)[\s\S]*setFramingApplied\(true\)/);
});

test('featured product drafts keep real thumbnails and exclude TEST/PRUEBA categories', () => {
  const drafts = toFeaturedDraft([
    product({ id: 'real', imageUrl: 'https://images.example.test/andador.jpg' }),
    product({ id: 'test', category: ' TEST ', imageUrl: 'https://images.example.test/test.jpg' }),
    product({ id: 'prueba', category: 'PrUeBa' }),
  ]);
  assert.deepEqual(drafts.map((item) => item.id), ['real']);
  assert.equal(drafts[0].imageUrl, 'https://images.example.test/andador.jpg');
  const markup = renderToStaticMarkup(React.createElement(ProductThumbnail, { product: drafts[0] }));
  assert.match(markup, /src="https:\/\/images\.example\.test\/andador\.jpg"/);
});

test('featured products show a neutral Sin imagen placeholder and clear visibility labels', () => {
  const [draft] = toFeaturedDraft([product({ active: false, imageUrl: '' })]);
  const markup = renderToStaticMarkup(React.createElement(ProductThumbnail, { product: draft }));
  assert.match(markup, /Sin imagen/);
  assert.doesNotMatch(markup, /<img/);
  assert.equal(productVisibilityLabel(draft), 'Oculto');
  assert.equal(productVisibilityLabel({ active: true }), 'Visible');
});

test('all section controls are keyboard buttons with accessible expanded state and no technical vocabulary', () => {
  const markup = renderEditPage();
  assert.equal((markup.match(/<button/g) ?? []).length, 5);
  assert.equal((markup.match(/aria-controls=/g) ?? []).length, 5);
  const forbidden = [/\bacordeón\b/i, /\bpanel\b/i, /\bschema\b/i, /\bdocumento\b/i, /\bCTA\b/i, /\bRPC\b/i, /cloudinary/i, /supabase/i];
  for (const pattern of forbidden) assert.doesNotMatch(markup, pattern, `forbidden visible vocabulary matched: ${pattern}`);
});
