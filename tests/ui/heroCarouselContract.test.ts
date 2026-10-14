import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

test('CONTRACT: HeroCarousel respects prefers-reduced-motion (no autoplay, no transition) via the shared hook', () => {
  const source = readFileSync(join(process.cwd(), 'src/components/HeroCarousel.tsx'), 'utf8');
  assert.match(source, /usePrefersReducedMotion/);
  assert.match(source, /prefersReducedMotion/);
});

test('CONTRACT: HeroCarousel autoplay pauses on hover/focus/touch interaction', () => {
  const source = readFileSync(join(process.cwd(), 'src/components/HeroCarousel.tsx'), 'utf8');
  assert.match(source, /onMouseEnter/);
  assert.match(source, /onFocus/);
  assert.match(source, /onTouchStart/);
  assert.match(source, /isInteracting/);
});

test('CONTRACT: HeroCarousel controls are accessible -- aria-labels on prev/next/dots, carousel role, no permanent autoplay announcement', () => {
  const source = readFileSync(join(process.cwd(), 'src/components/HeroCarousel.tsx'), 'utf8');
  assert.match(source, /aria-label="Imagen anterior"/);
  assert.match(source, /aria-label="Imagen siguiente"/);
  assert.match(source, /aria-label=\{`Ir a la imagen/);
  assert.match(source, /aria-roledescription="carousel"/);
  assert.doesNotMatch(source, /aria-live/);
});

test('CONTRACT: only the first slide gets fetchPriority "high" -- later slides are not downloaded aggressively', () => {
  const source = readFileSync(join(process.cwd(), 'src/components/HeroCarousel.tsx'), 'utf8');
  assert.match(source, /fetchPriority=\{index === 0 \? 'high' : 'low'\}/);
});

test('CONTRACT: HeroCarousel is pure presentation -- no fetch, no Supabase', () => {
  const source = readFileSync(join(process.cwd(), 'src/components/HeroCarousel.tsx'), 'utf8');
  assert.doesNotMatch(source, /\bfetch\(/);
  assert.doesNotMatch(source, /from ['"]@supabase|createClient/);
});
