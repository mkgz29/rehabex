import assert from 'node:assert/strict';
import test from 'node:test';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';

import { HeroSection } from '../../src/components/HeroSection.tsx';
import { ImageField } from '../../src/admin/components/ImageField.tsx';
import { defaultLandingContent } from '../../src/lib/defaultContent.ts';
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
  eyebrow: 'Eyebrow de prueba',
  image_url: '',
  primary_cta_text: 'Ir',
  primary_cta_link: '/tienda',
  images: [],
};

function renderHero(heroContent: HeroContent, isLoading: boolean) {
  return renderToStaticMarkup(
    React.createElement(MemoryRouter, null, React.createElement(HeroSection, { heroContent, isLoading })),
  );
}

test('Hero: while loading, there is no img element and no image URL is ever referenced', () => {
  const markup = renderHero({ ...baseHero, images: [{ mediaAssetId: null, url: 'https://res.cloudinary.com/demo/image/upload/v1/hero.jpg', alt: '', enabled: true, displayOrder: 0 }] }, true);
  assert.doesNotMatch(markup, /<img/);
  assert.doesNotMatch(markup, /unsplash/i);
  assert.doesNotMatch(markup, /cloudinary/i);
  assert.match(markup, /aria-busy="true"/);
});

test('Hero: loaded with a single persisted image renders exactly that URL, no carousel controls', () => {
  const markup = renderHero({ ...baseHero, images: [{ mediaAssetId: null, url: 'https://images.example.test/persisted-hero.jpg', alt: '', enabled: true, displayOrder: 0 }] }, false);
  assert.match(markup, /<img/);
  assert.match(markup, /src="https:\/\/images\.example\.test\/persisted-hero\.jpg"/);
  assert.doesNotMatch(markup, /Imagen no configurada/);
  assert.doesNotMatch(markup, /unsplash/i);
  assert.doesNotMatch(markup, /Ir a la imagen/);
});

test('Hero: loaded with no persisted images shows "Imagen no configurada" and no img element', () => {
  const markup = renderHero({ ...baseHero, images: [] }, false);
  assert.doesNotMatch(markup, /<img/);
  assert.match(markup, /Imagen no configurada/);
  assert.doesNotMatch(markup, /unsplash/i);
});

test('Hero: loaded with 2+ images renders a carousel with line indicators (no prev/next arrows) for each slide', () => {
  const markup = renderHero(
    {
      ...baseHero,
      images: [
        { mediaAssetId: null, url: 'https://images.example.test/slide-1.jpg', alt: 'Primera', enabled: true, displayOrder: 0 },
        { mediaAssetId: null, url: 'https://images.example.test/slide-2.jpg', alt: 'Segunda', enabled: true, displayOrder: 1 },
      ],
    },
    false,
  );
  assert.doesNotMatch(markup, /Imagen anterior/);
  assert.doesNotMatch(markup, /Imagen siguiente/);
  assert.match(markup, /Ir a la imagen 1 de 2/);
  assert.match(markup, /Ir a la imagen 2 de 2/);
  assert.match(markup, /slide-1\.jpg/);
  assert.match(markup, /slide-2\.jpg/);
});

// --- Loading-state guardrail (FASE 7D.3-B3): never paint defaultLandingContent text as real while isLoading ---

test('Hero: while loading, the default title/subtitle/CTA text never render, even though they are what the hook initializes with', () => {
  const markup = renderHero(defaultLandingContent.hero, true);
  assert.doesNotMatch(markup, /Recuperacion con confianza\./);
  assert.doesNotMatch(markup, /Equipamiento y soluciones para rehabilitacion profesional/);
  assert.doesNotMatch(markup, /Explorar productos/);
});

test('Hero: while loading, the title/CTA elements stay mounted (stable aria-labelledby target) with hidden skeleton content', () => {
  const markup = renderHero(defaultLandingContent.hero, true);
  assert.match(markup, /id="hero-title"/);
  assert.match(markup, /aria-hidden="true"/);
});

test('Hero: loaded (isLoading=false) with the real document renders its title/subtitle/CTA normally', () => {
  const markup = renderHero({ ...baseHero, title: 'REHABEX BOOTS', subtitle: 'Subtitulo real', primary_cta_text: 'Ir a la tienda' }, false);
  assert.match(markup, /REHABEX BOOTS/);
  assert.match(markup, /Subtitulo real/);
  assert.match(markup, /Ir a la tienda/);
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
