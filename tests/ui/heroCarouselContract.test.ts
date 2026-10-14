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

test('CONTRACT: no previous/next arrow controls -- line indicators are the only manual navigation', () => {
  const source = readFileSync(join(process.cwd(), 'src/components/HeroCarousel.tsx'), 'utf8');
  assert.doesNotMatch(source, /aria-label="Imagen anterior"/);
  assert.doesNotMatch(source, /aria-label="Imagen siguiente"/);
  assert.doesNotMatch(source, /ChevronLeft|ChevronRight/);
});

test('CONTRACT: indicators are short horizontal lines (not round dots), accessible, carousel role present, no permanent autoplay announcement', () => {
  const source = readFileSync(join(process.cwd(), 'src/components/HeroCarousel.tsx'), 'utf8');
  assert.match(source, /aria-label=\{`Ir a la imagen/);
  assert.match(source, /aria-current=\{i === safeIndex\}/);
  assert.match(source, /h-\[3px\]/);
  assert.doesNotMatch(source, /h-2\.5 w-2\.5/);
  assert.match(source, /aria-roledescription="carousel"/);
  assert.doesNotMatch(source, /aria-live/);
});

test('CONTRACT: the active indicator is visually distinguished from inactive ones (wider + fuller opacity)', () => {
  const source = readFileSync(join(process.cwd(), 'src/components/HeroCarousel.tsx'), 'utf8');
  assert.match(source, /i === safeIndex \? 'w-8 bg-white' : 'w-5 bg-white\/45/);
});

test('CONTRACT: clicking an indicator goes directly to that slide, and does not set a lasting pause flag', () => {
  const source = readFileSync(join(process.cwd(), 'src/components/HeroCarousel.tsx'), 'utf8');
  assert.match(source, /onClick=\{\(\) => goTo\(i\)\}/);
  assert.match(source, /const goTo = \(next: number\) => setIndex\(next\);/);
});

test('CONTRACT: autoplay restarts its countdown on any index change (manual pick or tick) -- the effect depends on `index`', () => {
  const source = readFileSync(join(process.cwd(), 'src/components/HeroCarousel.tsx'), 'utf8');
  assert.match(source, /\[images\.length, prefersReducedMotion, isInteracting, index\]/);
});

test('CONTRACT: autoplay interval is exactly 5000ms', () => {
  const source = readFileSync(join(process.cwd(), 'src/lib/heroCarousel.ts'), 'utf8');
  assert.match(source, /HERO_CAROUSEL_AUTOPLAY_MS = 5000/);
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
