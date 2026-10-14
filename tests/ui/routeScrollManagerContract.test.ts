import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

test('CONTRACT: RouteScrollManager delegates the actual decision to the pure decideScrollAction helper', () => {
  const source = readFileSync(join(process.cwd(), 'src/components/RouteScrollManager.tsx'), 'utf8');
  assert.match(source, /decideScrollAction/);
  assert.match(source, /useLocation/);
  assert.match(source, /useNavigationType/);
});

test('CONTRACT: the "top" case scrolls with behavior "auto", never "smooth" -- a page opens at its top instantly, not by gliding there', () => {
  const source = readFileSync(join(process.cwd(), 'src/components/RouteScrollManager.tsx'), 'utf8');
  assert.match(source, /window\.scrollTo\(\{ top: 0, left: 0, behavior: 'auto' \}\)/);
});

test('CONTRACT: the "anchor" case uses scrollIntoView with behavior "smooth", preserving the existing anchor UX', () => {
  const source = readFileSync(join(process.cwd(), 'src/components/RouteScrollManager.tsx'), 'utf8');
  assert.match(source, /scrollIntoView\(\{ behavior: 'smooth' \}\)/);
});

test('CONTRACT: RouteScrollManager is mounted exactly once, in AppLayout (the public layout) -- not per-page', () => {
  const appLayout = readFileSync(join(process.cwd(), 'src/components/AppLayout.tsx'), 'utf8');
  assert.match(appLayout, /<RouteScrollManager \/>/);

  // No page component calls window.scrollTo itself -- the manager is the
  // single place that owns this behavior.
  const pagesDir = join(process.cwd(), 'src/pages');
  for (const file of readdirSync(pagesDir)) {
    if (!file.endsWith('.tsx')) continue;
    const pageSource = readFileSync(join(pagesDir, file), 'utf8');
    assert.doesNotMatch(pageSource, /window\.scrollTo/, `${file} should not call window.scrollTo itself`);
  }
});

test('CONTRACT: SiteHeader no longer duplicates anchor-scroll logic -- RouteScrollManager is the single owner of it now', () => {
  const source = readFileSync(join(process.cwd(), 'src/components/SiteHeader.tsx'), 'utf8');
  assert.doesNotMatch(source, /scrollIntoView/);
});
