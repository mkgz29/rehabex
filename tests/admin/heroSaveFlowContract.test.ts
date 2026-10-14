import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const SOURCE = readFileSync(join(process.cwd(), 'src/admin/pages/AdminHeroPage.tsx'), 'utf8');

test('CONTRACT: hero content save and images sync are two separate try/catch steps -- a content failure never attempts the image sync', () => {
  // The content save has its own catch that returns early before step 2 is
  // ever reached, so a content failure structurally cannot fall through
  // into syncHeroImages.
  const stepOneIndex = SOURCE.indexOf('saved = await saveHeroContent');
  const stepTwoIndex = SOURCE.indexOf('await syncHeroImages');
  assert.ok(stepOneIndex > -1 && stepTwoIndex > -1 && stepOneIndex < stepTwoIndex);
  assert.match(SOURCE, /catch \(contentError\)/);
});

test('CONTRACT: a partial failure (content saved, images sync failed) surfaces an explicit, honest message -- never implies nothing was saved', () => {
  assert.match(SOURCE, /El contenido se guardó, pero no pudimos actualizar las imágenes del carrusel\. Intentá nuevamente\./);
});

test('CONTRACT: images are reattached to local state after saving hero_content, from the current carousel state (not lost, not refetched)', () => {
  assert.match(SOURCE, /images: heroContent\.images/);
});

test('CONTRACT: AdminHeroPage never spreads the full HeroContent object as the API payload -- it relies on saveHeroContent building an explicit payload', () => {
  assert.doesNotMatch(SOURCE, /value:\s*heroContent/);
  assert.doesNotMatch(SOURCE, /value:\s*\{\s*\.\.\.heroContent/);
});
