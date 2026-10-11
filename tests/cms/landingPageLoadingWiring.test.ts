import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

// LandingPage renders through useLandingData, a real data-fetching hook;
// mounting it here would mean a real network/Supabase call, which isn't
// appropriate for a unit test. Its wiring (does it forward isLoading to the
// sections that need it) is instead verified as a source-level contract --
// the same substitute this project's suite already uses elsewhere for
// render paths that can't be exercised directly (see AdminProductsPage's
// stock-field CONTRACT tests, tests/admin/adminProductsCatalog.test.ts).

function landingPageSource() {
  return readFileSync(join(process.cwd(), 'src/pages/LandingPage.tsx'), 'utf8');
}

test('CONTRACT: LandingPage passes isLoading to HeroSection, FeaturedProductsSection, AboutSection and SupportCtaSection', () => {
  const source = landingPageSource();
  assert.match(source, /<HeroSection heroContent=\{content\.hero\} isLoading=\{isLoading\} \/>/);
  assert.match(source, /<FeaturedProductsSection[^/]*isLoading=\{isLoading\}/);
  assert.match(source, /<AboutSection[^/]*isLoading=\{isLoading\}/);
  assert.match(source, /<SupportCtaSection[^/]*isLoading=\{isLoading\}/);
});

test('CONTRACT: CommercialFeatureSection keeps its own existing isLoading gate, unmodified (classified safe, out of scope)', () => {
  const source = landingPageSource();
  assert.match(source, /\{!isLoading && !productsError \? <Reveal><CommercialFeatureSection product=\{featuredProducts\[0\]\} \/><\/Reveal> : null\}/);
});
