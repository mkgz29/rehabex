import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const HOOK_SOURCE = readFileSync(join(process.cwd(), 'src/hooks/useProductCardHoverGallery.ts'), 'utf8');
const CARD_SOURCE = readFileSync(join(process.cwd(), 'src/components/ProductCard.tsx'), 'utf8');

// --- 3/4/5. timer lifecycle: single effect, cleared on leave/unmount, never duplicated ---

test('CONTRACT: exactly one setInterval call site, inside a useEffect that returns a clearInterval cleanup', () => {
  const intervalCalls = HOOK_SOURCE.match(/window\.setInterval\(/g) ?? [];
  assert.equal(intervalCalls.length, 1, 'expected exactly one setInterval call site -- never multiple concurrent timers');
  assert.match(HOOK_SOURCE, /return \(\) => window\.clearInterval\(timer\)/);
});

test('CONTRACT: the rotation effect is keyed on state.isHovering -- leaving re-runs the effect and fires its cleanup, stopping the timer', () => {
  assert.match(HOOK_SOURCE, /\[imageCount, state\.isHovering, prefersReducedMotion\]/);
});

test('CONTRACT: onMouseLeave goes through the shared leaveGallery engine function (not an inline reset) -- the hook owns no transition logic of its own', () => {
  assert.match(HOOK_SOURCE, /onMouseLeave: \(\) => setState\(\(current\) => leaveGallery\(current\)\)/);
});

test('CONTRACT: re-entering while already hovering cannot start a second timer -- state.isHovering is one boolean (via the shared enterGallery function), not a counter', () => {
  assert.match(HOOK_SOURCE, /useState<GalleryEngineState>\(INITIAL_GALLERY_ENGINE_STATE\)/);
  assert.match(HOOK_SOURCE, /onMouseEnter: \(\) => setState\(\(current\) => enterGallery\(current\)\)/);
});

// --- 6/7. reduced motion and pointer capability gate the same effect --------

test('CONTRACT: the hook checks prefersReducedMotion (via the shared hook) and prefersHoverCapable before ever starting a timer', () => {
  assert.match(HOOK_SOURCE, /usePrefersReducedMotion/);
  assert.match(HOOK_SOURCE, /prefersHoverCapable/);
  assert.match(HOOK_SOURCE, /shouldRotateGallery/);
});

// --- 8. per-image framing -----------------------------------------------------

test('CONTRACT: each gallery slide (primary and secondary) renders with its own image.framing, never a single shared framing for the whole card', () => {
  assert.match(CARD_SOURCE, /framing: primaryImage\?\.framing/);
  assert.match(CARD_SOURCE, /framing: image\.framing/);
});

// --- 9/10/11. the buy/detail buttons are untouched and stay stable -----------

test('CONTRACT: the "Agregar" (buy) button keeps its existing classes exactly -- no new hover/opacity/transform classes added to it by this phase', () => {
  const buttonMatch = CARD_SOURCE.match(/<button[\s\S]*?<\/button>/);
  assert.ok(buttonMatch, 'expected to find the buy button markup');
  const buttonMarkup = buttonMatch![0];
  assert.doesNotMatch(buttonMarkup, /opacity-0/);
  assert.doesNotMatch(buttonMarkup, /className="[^"]*\bhidden\b/);
  assert.doesNotMatch(buttonMarkup, /invisible/);
  assert.doesNotMatch(buttonMarkup, /display:\s*none/);
  assert.match(buttonMarkup, /className="brand-button gap-2 px-3 disabled:cursor-not-allowed disabled:bg-line disabled:text-muted"/);
  assert.match(buttonMarkup, /onClick=\{\(\) => onAddToCart\(product\)\}/);
});

test('CONTRACT: the "Ver detalle" link keeps its existing classes and href exactly, untouched by the gallery change', () => {
  assert.match(CARD_SOURCE, /<Link to=\{detailHref\} className="secondary-button w-11 px-0"/);
});

test('CONTRACT: the hover-gallery markup lives entirely inside the image Link, never inside the buttons row -- the gallery stack and the buttons never share a DOM subtree', () => {
  const buttonsRowIndex = CARD_SOURCE.indexOf('grid-cols-[1fr_auto]');
  const galleryStackIndex = CARD_SOURCE.indexOf('showGalleryStack');
  assert.ok(galleryStackIndex > -1 && buttonsRowIndex > -1 && galleryStackIndex < buttonsRowIndex);
});

// --- 12. 0-image fallback is unchanged -----------------------------------------

test('CONTRACT: the "Imagen no disponible" fallback for a product with no images is unchanged', () => {
  assert.match(CARD_SOURCE, /Imagen no disponible/);
});

// --- performance: secondary images never render before the first real hover ---

test('CONTRACT: secondary gallery slides only render when showGalleryStack is true -- never eagerly on mount', () => {
  assert.match(CARD_SOURCE, /\{showGalleryStack\s*\n?\s*\?\s*slides\.slice\(1\)\.map/);
});

// --- REGRESSION: the real production bug (undercounted imageCount) ----------

test("REGRESSION: ProductCard passes the hook the TOTAL slide count (primary + secondary), never just the secondary count -- the exact bug that silently broke rotation for any product with a primary + 1 more photo (2 total)", () => {
  assert.match(CARD_SOURCE, /useProductCardHoverGallery\(slides\.length\)/);
  assert.doesNotMatch(CARD_SOURCE, /useProductCardHoverGallery\(secondarySlides\.length\)/);
  assert.doesNotMatch(CARD_SOURCE, /useProductCardHoverGallery\(gallerySlides\.length\)/);
});

test('CONTRACT: slides is built as [primaryImage, ...secondarySlides] -- the primary is never duplicated and always rendered first', () => {
  assert.match(CARD_SOURCE, /const slides = primaryImage \? \[primaryImage, \.\.\.secondarySlides\] : secondarySlides;/);
});
