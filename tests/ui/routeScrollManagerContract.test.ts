import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const MANAGER_SOURCE = readFileSync(join(process.cwd(), 'src/components/RouteScrollManager.tsx'), 'utf8');

test('CONTRACT: RouteScrollManager delegates the decision to the pure decideScrollAction helper', () => {
  assert.match(MANAGER_SOURCE, /decideScrollAction/);
  assert.match(MANAGER_SOURCE, /useLocation/);
  assert.match(MANAGER_SOURCE, /useNavigationType/);
});

test('CONTRACT: the "top" case uses behavior "auto", never "smooth" -- a page opens at its top instantly', () => {
  assert.match(MANAGER_SOURCE, /window\.scrollTo\(\{ top: 0, left: 0, behavior: 'auto' \}\)/);
});

test('CONTRACT: the anchor case uses scrollIntoView with behavior "auto" and block "start"', () => {
  assert.match(MANAGER_SOURCE, /scrollIntoView\(\{ behavior: 'auto', block: 'start' \}\)/);
});

// --- 10. the retry loop is bounded and always cleaned up --------------------

test("10. the anchor retry loop is bounded (uses ANCHOR_SCROLL_MAX_RETRIES, not an unconditional recursive call) and falls back to top when exhausted", () => {
  assert.match(MANAGER_SOURCE, /ANCHOR_SCROLL_MAX_RETRIES/);
  assert.match(MANAGER_SOURCE, /if \(attempt >= ANCHOR_SCROLL_MAX_RETRIES\)/);
  // The fallback path still scrolls to top rather than leaving the visitor
  // wherever the previous route happened to leave them.
  const fallbackSection = MANAGER_SOURCE.slice(MANAGER_SOURCE.indexOf('if (attempt >= ANCHOR_SCROLL_MAX_RETRIES)'));
  assert.match(fallbackSection, /window\.scrollTo\(\{ top: 0, left: 0, behavior: 'auto' \}\)/);
});

test('10. every requestAnimationFrame scheduled by the retry loop is cancelled on cleanup -- no pending frame survives a route change or unmount', () => {
  assert.match(MANAGER_SOURCE, /window\.requestAnimationFrame\(/);
  assert.match(MANAGER_SOURCE, /window\.cancelAnimationFrame\(frame\)/);
  assert.match(MANAGER_SOURCE, /cancelled = true;/);
  // The recursive retry checks the cancellation flag before doing anything,
  // so a frame that fires after cleanup is a no-op rather than a stray
  // scroll or a further recursive schedule.
  assert.match(MANAGER_SOURCE, /if \(cancelled\) return;/);
});

test('CONTRACT: sticky-header offset for anchors comes from the existing global scroll-padding-top, not a per-component magic number', () => {
  const css = readFileSync(join(process.cwd(), 'src/index.css'), 'utf8');
  assert.match(css, /scroll-padding-top:\s*7rem/);
  assert.doesNotMatch(MANAGER_SOURCE, /scrollIntoView\([^)]*top:\s*-?\d+/);
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

// --- 9 (component side): Admin's own layout never imports/renders this ------

test('9. AdminLayout does not import or render RouteScrollManager directly -- the exclusion for /admin lives entirely in decideScrollAction, not in a second code path', () => {
  const adminLayout = readFileSync(join(process.cwd(), 'src/admin/components/AdminLayout.tsx'), 'utf8');
  assert.doesNotMatch(adminLayout, /RouteScrollManager/);
});

test('CONTRACT: SiteHeader no longer duplicates anchor-scroll logic -- RouteScrollManager is the single owner of it now', () => {
  const source = readFileSync(join(process.cwd(), 'src/components/SiteHeader.tsx'), 'utf8');
  assert.doesNotMatch(source, /scrollIntoView/);
});

test('CONTRACT: Link/NavLink navigation is preserved -- no window.location.href reload anywhere touched by this phase', () => {
  const navbar = readFileSync(join(process.cwd(), 'src/components/SiteHeader.tsx'), 'utf8');
  assert.doesNotMatch(navbar, /window\.location\.href\s*=/);
});
