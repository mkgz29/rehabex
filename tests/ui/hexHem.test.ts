import assert from 'node:assert/strict';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8').replace(/\r\n/g, '\n');
const css = read('src/index.css');
const block = (selector: string) => {
  const start = css.indexOf(`${selector} {`);
  return start < 0 ? '' : css.slice(start, css.indexOf('\n  }', start));
};

test('Hex hem: the warm orange gradient and the old 2D SVG honeycomb are gone, one system remains', () => {
  assert.doesNotMatch(css, /warm-hem|warm-drift/);
  assert.doesNotMatch(css, /data:image\/svg\+xml,%3Csvg[^"]*polygon/); // previous inline 2D tile
  assert.doesNotMatch(css, /hex-hem--sheen|hex-sheen/); // previous moving glint
  assert.match(read('src/components/HeroSection.tsx'), /hex-hem hex-hem--hero/);
  assert.match(read('src/components/FeaturedProductsSection.tsx'), /hex-hem hex-hem--ruled/);
});

test('Hex hem: it uses the 3D metal honeycomb asset (optimised WebP), the original PNG is kept', () => {
  const png = join(process.cwd(), 'src/assets/auth/rehabex-hex-metal-3d.png');
  const webp = join(process.cwd(), 'src/assets/auth/rehabex-hex-metal-3d.webp');
  assert.ok(existsSync(png), 'original PNG stays in the repo');
  assert.ok(existsSync(webp), 'web version exists');
  assert.ok(statSync(webp).size < statSync(png).size / 5, 'WebP is a fraction of the PNG weight');
  assert.ok(statSync(webp).size < 200_000);
  const header = readFileSync(webp).subarray(0, 12).toString('latin1');
  assert.equal(header.slice(0, 4), 'RIFF');
  assert.equal(header.slice(8, 12), 'WEBP');
  assert.match(block('  .hex-hem::before'), /background-image: url\('\.\/assets\/auth\/rehabex-hex-metal-3d\.webp'\);/);
});

test('Hex hem: a background layer behind the content, bottom-anchored, never a rectangular edge, no blur', () => {
  const base = block('  .hex-hem');
  assert.match(base, /position: relative;/);
  assert.match(base, /isolation: isolate;/);
  const layer = block('  .hex-hem::before');
  assert.match(layer, /z-index: -1;/);
  assert.match(layer, /pointer-events: none;/);
  assert.match(layer, /bottom: 0;/);
  assert.match(layer, /background-size: cover;/);
  assert.match(layer, /background-position: center bottom;/);
  assert.match(layer, /background-repeat: no-repeat;/);
  assert.match(layer, /opacity: var\(--hex-hem-strength\);/);
  // Strongest at the very bottom, fully transparent at the top of the band.
  assert.match(layer, /-webkit-mask-image: linear-gradient\(to top, #000 0%, [^;]*transparent 100%\);/);
  assert.match(layer, /\n    mask-image: linear-gradient\(to top, #000 0%, [^;]*transparent 100%\);/);
  assert.doesNotMatch(layer, /blur|filter/);
});

test('Hex hem: hero strongest, featured lighter, softer on phones; the hero hem stays below the tablet CTAs', () => {
  const strength = (selectorBlock: string) => Number(/--hex-hem-strength: ([0-9.]+);/.exec(selectorBlock)?.[1]);
  const hero = strength(block('  .hex-hem--hero'));
  const featured = strength(block('  .hex-hem--ruled'));
  assert.ok(hero > featured, 'hero hem is stronger than featured');
  assert.ok(hero <= 0.8 && featured <= 0.4);
  const phones = /@media \(max-width: 767px\) \{([\s\S]*?)\n  \}\n/.exec(css)?.[1] ?? '';
  assert.match(phones, /\.hex-hem--hero \{\s*--hex-hem-strength: 0\.55;/);
  assert.match(phones, /\.hex-hem--ruled \{\s*--hex-hem-strength: 0\.22;/);
  assert.match(css, /@media \(min-width: 768px\) and \(max-width: 1023px\) \{\s*\.hex-hem--hero \{\s*--hex-hem-height: 6\.5rem;/);
  // Featured keeps the hairline that closes the section.
  assert.match(block('  .hex-hem--ruled'), /linear-gradient\(to top, rgb\(var\(--color-stone\) \/ 0\.5\) 0 1px, transparent 1px\)/);
});
