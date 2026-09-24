import assert from 'node:assert/strict';
import test from 'node:test';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';

import { HeroSection } from '../../src/components/HeroSection.tsx';
import { ImageField } from '../../src/admin/components/ImageField.tsx';
import type { HeroContent } from '../../src/types/cms.ts';

(globalThis as typeof globalThis & { React: typeof React }).React = React;

// The image-load-failure state ("Imagen no disponible") in both HeroSection
// and ImageField is only reachable via a real <img> onError callback, which
// never fires during static server rendering. That state is covered instead
// by resolveMediaSlotState's own unit tests (cmsImageLoading.test.ts) plus
// manual visual QA against a deliberately broken URL, not here.

const baseHero: HeroContent = {
  title: 'Titulo de prueba',
  subtitle: 'Subtitulo de prueba',
  image_url: '',
  primary_cta_text: 'Ir',
  primary_cta_link: '/tienda',
};

function renderHero(heroContent: HeroContent, isLoading: boolean) {
  return renderToStaticMarkup(
    React.createElement(MemoryRouter, null, React.createElement(HeroSection, { heroContent, isLoading })),
  );
}

test('Hero: while loading, there is no img element and no image URL is ever referenced', () => {
  const markup = renderHero({ ...baseHero, image_url: 'https://res.cloudinary.com/demo/image/upload/v1/hero.jpg' }, true);
  assert.doesNotMatch(markup, /<img/);
  assert.doesNotMatch(markup, /unsplash/i);
  assert.doesNotMatch(markup, /cloudinary/i);
  assert.match(markup, /aria-busy="true"/);
});

test('Hero: loaded with a persisted image renders exactly that URL, nothing else', () => {
  const markup = renderHero({ ...baseHero, image_url: 'https://images.example.test/persisted-hero.jpg' }, false);
  assert.match(markup, /<img/);
  assert.match(markup, /src="https:\/\/images\.example\.test\/persisted-hero\.jpg"/);
  assert.doesNotMatch(markup, /Imagen no configurada/);
  assert.doesNotMatch(markup, /unsplash/i);
});

test('Hero: loaded with no persisted image shows "Imagen no configurada" and no img element', () => {
  const markup = renderHero({ ...baseHero, image_url: '' }, false);
  assert.doesNotMatch(markup, /<img/);
  assert.match(markup, /Imagen no configurada/);
  assert.doesNotMatch(markup, /unsplash/i);
});

test('ImageField: while the parent form is loading, shows a skeleton and never the passed-in value', () => {
  const markup = renderToStaticMarkup(
    React.createElement(ImageField, {
      label: 'Imagen',
      value: 'https://images.example.test/should-not-render-yet.jpg',
      intent: 'hero',
      isLoading: true,
      onAssetReady: () => undefined,
    }),
  );
  assert.doesNotMatch(markup, /<img/);
  assert.doesNotMatch(markup, /Imagen no configurada/);
  assert.doesNotMatch(markup, /should-not-render-yet/);
  assert.match(markup, /aria-busy="true"/);
});

test('ImageField: loaded with no persisted value shows "Imagen no configurada" and no img element', () => {
  const markup = renderToStaticMarkup(
    React.createElement(ImageField, {
      label: 'Imagen',
      value: '',
      intent: 'hero',
      isLoading: false,
      onAssetReady: () => undefined,
    }),
  );
  assert.doesNotMatch(markup, /<img/);
  assert.match(markup, /Imagen no configurada/);
});

test('ImageField: loaded with a persisted value renders exactly that image', () => {
  const markup = renderToStaticMarkup(
    React.createElement(ImageField, {
      label: 'Imagen',
      value: 'https://images.example.test/persisted-about.jpg',
      intent: 'about',
      isLoading: false,
      onAssetReady: () => undefined,
    }),
  );
  assert.match(markup, /src="https:\/\/images\.example\.test\/persisted-about\.jpg"/);
});

test('ImageField: defaults isLoading to false, so existing callers (products) are unaffected', () => {
  const markup = renderToStaticMarkup(
    React.createElement(ImageField, {
      label: 'Imagen',
      value: 'https://images.example.test/product.jpg',
      intent: 'product',
      onAssetReady: () => undefined,
    }),
  );
  assert.match(markup, /src="https:\/\/images\.example\.test\/product\.jpg"/);
});
