import assert from 'node:assert/strict';
import test from 'node:test';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';

import { AboutSection } from '../../src/components/AboutSection.tsx';
import { FeaturedProductsSection } from '../../src/components/FeaturedProductsSection.tsx';
import { CatalogCtaSection } from '../../src/components/CatalogCtaSection.tsx';
import { CartProvider } from '../../src/cart/CartProvider.tsx';
import { defaultLandingContent } from '../../src/lib/defaultContent.ts';
import type { AboutContent } from '../../src/types/cms.ts';

(globalThis as typeof globalThis & { React: typeof React }).React = React;

function render(node: React.ReactElement) {
  return renderToStaticMarkup(React.createElement(MemoryRouter, null, node));
}

const baseAbout: AboutContent = { ...defaultLandingContent.about, image: '' };

test('Acerca de Rehabex: renders the real configured metrics, not the old hardcoded principles', () => {
  const content: AboutContent = { ...baseAbout, metrics: [{ id: 'm1', value: '+900', label: 'clientes atendidos' }] };
  const markup = render(React.createElement(AboutSection, { content, products: [] }));
  assert.match(markup, /\+900/);
  assert.match(markup, /clientes atendidos/);
  assert.doesNotMatch(markup, /Rehabilitación<\/p>/); // the old hardcoded "principles" card title
  assert.doesNotMatch(markup, /Movilidad<\/p>/);
});

test('Acerca de Rehabex: a metric left fully empty is skipped, the other one still renders', () => {
  const content: AboutContent = {
    ...baseAbout,
    metrics: [
      { id: 'm1', value: '', label: '' },
      { id: 'm2', value: '24/7', label: 'atención' },
    ],
  };
  const markup = render(React.createElement(AboutSection, { content, products: [] }));
  assert.match(markup, /24\/7/);
  assert.match(markup, /atención/);
});

test('Acerca de Rehabex: when every metric is empty, the whole "Datos destacados" block disappears (no hollow container)', () => {
  const content: AboutContent = {
    ...baseAbout,
    metrics: [
      { id: 'm1', value: '', label: '' },
      { id: 'm2', value: '', label: '' },
    ],
  };
  const markup = render(React.createElement(AboutSection, { content, products: [] }));
  assert.doesNotMatch(markup, /border-y border-white\/15/);
});

test('Acerca de Rehabex: never invents a metric value or falls back to commercial defaults when the document has none', () => {
  const content: AboutContent = { ...baseAbout, metrics: [] };
  const markup = render(React.createElement(AboutSection, { content, products: [] }));
  assert.doesNotMatch(markup, /\+500/); // the seeded default value, must not leak in when the real doc says "no metrics"
});

test('Productos destacados: title and subtitle come from the real section content, not a hardcoded string', () => {
  const markup = render(
    React.createElement(
      CartProvider,
      null,
      React.createElement(FeaturedProductsSection, {
        content: { title: 'Nuestra selección de este mes', subtitle: 'Curado por el equipo Rehabex.' },
        products: [],
        isLoading: false,
        error: null,
        onRetry: () => undefined,
      }),
    ),
  );
  assert.match(markup, /Nuestra selección de este mes/);
  assert.match(markup, /Curado por el equipo Rehabex\./);
});

test('Catálogo Rehabex: title and subtitle come from the real section content, not a hardcoded string', () => {
  const markup = render(
    React.createElement(CatalogCtaSection, { content: { title: 'Mirá el catálogo completo', subtitle: 'Todo lo que ofrecemos, en un solo lugar.' } }),
  );
  assert.match(markup, /Mirá el catálogo completo/);
  assert.match(markup, /Todo lo que ofrecemos, en un solo lugar\./);
});
