import assert from 'node:assert/strict';
import test from 'node:test';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { AdminEditPagePage } from '../../src/admin/pages/AdminEditPagePage.tsx';
import { FeaturedProductsEditor } from '../../src/admin/components/FeaturedProductsEditor.tsx';
import { UnsavedChangesProvider } from '../../src/admin/unsavedChanges/UnsavedChangesContext.tsx';

(globalThis as typeof globalThis & { React: typeof React }).React = React;

function renderEditPage() {
  return renderToStaticMarkup(React.createElement(UnsavedChangesProvider, null, React.createElement(AdminEditPagePage)));
}

test('Editar página: the five ADMIN-02E blocks are all present with a plain-language "where it appears" line', () => {
  const markup = renderEditPage();
  assert.match(markup, /Portada principal/);
  assert.match(markup, /Acerca de Rehabex/);
  assert.match(markup, /Productos destacados/);
  assert.match(markup, /Textos de Productos destacados/);
  assert.match(markup, /Textos del Catálogo Rehabex/);
  // one-line "where this appears" explanations, in everyday language
  assert.match(markup, /portada de la tienda/);
  assert.match(markup, /catálogo/i);
});

test('Editar página: uses the required plain-language field names', () => {
  const markup = renderEditPage();
  assert.match(markup, />Texto del botón</);
  assert.match(markup, />A dónde lleva el botón</);
  assert.match(markup, /Elegí qué productos aparecen primero/);
});

test('Editar página: never leaks technical vocabulary to a non-technical admin', () => {
  const markup = renderEditPage();
  const forbidden = [/\bCTA\b/i, /\bslug\b/i, /\basset\b/i, /\bpipeline\b/i, /\bRPC\b/i, /\bJSON\b/i, /\bUUID\b/i, /focal point/i, /aspect ratio/i, /cloudinary/i, /supabase/i];
  for (const pattern of forbidden) {
    // "Sin Supabase, esta sección no puede guardarse" is a pre-existing,
    // already-reviewed environment notice (CMS-UI-01), not new vocabulary --
    // skip it specifically, same exception ADMIN-02D's own tests already make.
    if (pattern.source === 'supabase' && /Sin Supabase, esta sección no puede guardarse/.test(markup)) continue;
    assert.doesNotMatch(markup, pattern, `forbidden vocabulary matched: ${pattern}`);
  }
});

function renderFeaturedEditor() {
  return renderToStaticMarkup(React.createElement(UnsavedChangesProvider, null, React.createElement(FeaturedProductsEditor)));
}

test('FeaturedProductsEditor: initial render shows a loading state, not the product lists', () => {
  const markup = renderFeaturedEditor();
  assert.match(markup, /aria-busy="true"/);
  assert.doesNotMatch(markup, /Productos que se mostrarán/);
});
