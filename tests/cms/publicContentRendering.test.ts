import assert from 'node:assert/strict';
import test from 'node:test';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';

import { AboutSection } from '../../src/components/AboutSection.tsx';
import { FeaturedProductsSection } from '../../src/components/FeaturedProductsSection.tsx';
import { SupportCtaSection } from '../../src/components/SupportCtaSection.tsx';
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
  const markup = render(React.createElement(AboutSection, { content, products: [], isLoading: false }));
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
  const markup = render(React.createElement(AboutSection, { content, products: [], isLoading: false }));
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
  const markup = render(React.createElement(AboutSection, { content, products: [], isLoading: false }));
  assert.doesNotMatch(markup, /border-y border-white\/15/);
});

test('Acerca de Rehabex: never invents a metric value or falls back to commercial defaults when the document has none', () => {
  const content: AboutContent = { ...baseAbout, metrics: [] };
  const markup = render(React.createElement(AboutSection, { content, products: [], isLoading: false }));
  assert.doesNotMatch(markup, /\+500/); // the seeded default value, must not leak in when the real doc says "no metrics"
});

// --- Loading-state guardrail (FASE 7D.3-B3): never paint defaultLandingContent as real while isLoading ---

test('Acerca de Rehabex: while loading, the default title/description never render, even though they are what the hook initializes with', () => {
  const markup = render(React.createElement(AboutSection, { content: defaultLandingContent.about, products: [], isLoading: true }));
  assert.doesNotMatch(markup, /Soluciones para acompañar cada etapa de recuperación\./);
  assert.doesNotMatch(markup, /Somos un equipo enfocado en rehabilitacion/);
});

test('Acerca de Rehabex: while loading, the default metrics never render (no "Datos destacados" flash)', () => {
  const markup = render(React.createElement(AboutSection, { content: defaultLandingContent.about, products: [], isLoading: true }));
  assert.doesNotMatch(markup, /\+500/);
  assert.doesNotMatch(markup, /24\/7/);
});

test('Acerca de Rehabex: loaded (isLoading=false) with real content renders it normally', () => {
  const content: AboutContent = { ...baseAbout, title: 'Titulo real', description: 'Descripcion real' };
  const markup = render(React.createElement(AboutSection, { content, products: [], isLoading: false }));
  assert.match(markup, /Titulo real/);
  assert.match(markup, /Descripcion real/);
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

test('Productos destacados: while loading, the default heading/subtitle never render', () => {
  const markup = render(
    React.createElement(
      CartProvider,
      null,
      React.createElement(FeaturedProductsSection, {
        content: defaultLandingContent.featuredSection,
        products: [],
        isLoading: true,
        error: null,
        onRetry: () => undefined,
      }),
    ),
  );
  assert.doesNotMatch(markup, /Elegidos para acompañar tu recuperación/);
  assert.doesNotMatch(markup, /Conocé una selección del catálogo activo de Rehabex\./);
});

test('Consultas Rehabex: title and subtitle come from the real section content, not a hardcoded string', () => {
  const markup = render(
    React.createElement(SupportCtaSection, {
      content: { title: 'Mirá el catálogo completo', subtitle: 'Todo lo que ofrecemos, en un solo lugar.' },
      isLoading: false,
    }),
  );
  assert.match(markup, /Mirá el catálogo completo/);
  assert.match(markup, /Todo lo que ofrecemos, en un solo lugar\./);
});

test('Consultas Rehabex: while loading, the default title/subtitle never render', () => {
  const markup = render(
    React.createElement(SupportCtaSection, { content: defaultLandingContent.catalogSection, isLoading: true }),
  );
  assert.doesNotMatch(markup, /¿Necesitás ayuda\?/);
  assert.doesNotMatch(markup, /Escribinos si tenés dudas/);
});

test('Consultas Rehabex: CTA points to /soporte with the new copy, not the old catalog destination', () => {
  const markup = render(
    React.createElement(SupportCtaSection, { content: { title: 'x', subtitle: 'y' }, isLoading: false }),
  );
  assert.match(markup, /href="\/soporte"/);
  assert.match(markup, />Hacer una consulta</);
  assert.doesNotMatch(markup, /href="\/tienda"/);
  assert.doesNotMatch(markup, />Ver catálogo</);
});

test('Consultas Rehabex: the support link stays functional and unchanged even while loading', () => {
  const markup = render(
    React.createElement(SupportCtaSection, { content: defaultLandingContent.catalogSection, isLoading: true }),
  );
  assert.match(markup, /href="\/soporte"/);
  assert.match(markup, />Hacer una consulta</);
});
