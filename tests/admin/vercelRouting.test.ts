import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

// A passing dispatcher unit test previously gave false confidence: it proved
// *the dispatcher file's own routing logic* works, but said nothing about
// whether Vercel's real request routing (vercel.json rewrites, evaluated
// before any function code runs) ever delivers a request to it at all. That
// gap let two real regressions reach Preview and Production undetected:
//
//   1. The catch-all rewrite `/api/(.*)` -> /api/404 shadowed every request
//      under /api/admin/*, so the dispatcher never ran (proven live: it
//      returned 404 for every method, including OPTIONS and an authenticated
//      POST, which is impossible if the dispatcher itself had run).
//   2. A `[...path].ts` catch-all compiled, on this project's zero-config
//      Vite build (not Next.js), to a *single*-segment regex (`[^/]+`),
//      matching /api/admin/foo but never a two-segment route like
//      /api/admin/products/create -- confirmed against a real `vercel build`
//      output (.vercel/output/config.json), then fixed by switching to
//      nested single dynamic segments (api/admin/[category]/[action].ts).
//
// This file reproduces (1) against the real vercel.json content with the
// same regex construction Vercel uses (a bare parenthesized group in
// `source` is a literal regex fragment -- already relied on by the existing,
// working SPA-fallback rule), and guards against reintroducing (2) by
// asserting the filesystem shape directly, since re-verifying the compiled
// single-vs-multi-segment behavior requires a real `vercel build` (network +
// project auth), not something a unit test should depend on.

const projectRoot = process.cwd();
const vercelConfig = JSON.parse(readFileSync(join(projectRoot, 'vercel.json'), 'utf8')) as {
  rewrites: Array<{ source: string; destination: string }>;
  headers?: Array<{ source: string; headers: Array<{ key: string; value: string }> }>;
};

function rewriteTo(destination: string) {
  const rule = vercelConfig.rewrites.find((entry) => entry.destination === destination);
  assert.ok(rule, `expected a vercel.json rewrite targeting ${destination}`);
  return new RegExp(`^${rule!.source}$`);
}

test('vercel.json: the /api/404 rewrite does not shadow any /api/admin/* route', () => {
  const compiled = rewriteTo('/api/404');

  for (const adminPath of [
    '/api/admin/products/create',
    '/api/admin/products/update',
    '/api/admin/products/set-active',
    '/api/admin/settings/hero',
    '/api/admin/settings/about',
    '/api/admin/media/sign',
    '/api/admin/media/finalize',
    '/api/admin/support/list',
    '/api/admin/support/get',
    '/api/admin/support/create',
    '/api/admin/support/update-status',
    '/api/admin/support/update-notes',
    '/api/admin/reconcile-payment',
    '/api/admin/anything-unrecognized',
  ]) {
    assert.equal(compiled.test(adminPath), false, `${adminPath} must not be rewritten to /api/404 -- it would shadow a real admin function`);
  }
});

test('vercel.json: the /api/404 rewrite still catches every non-admin unmatched API path', () => {
  const compiled = rewriteTo('/api/404');

  for (const otherPath of ['/api/checkout', '/api/orders', '/api/order-status', '/api/mercadopago/webhook', '/api/totally-unknown']) {
    assert.equal(compiled.test(otherPath), true, `${otherPath} should still fall back to /api/404 when nothing else matches`);
  }
});

test('vercel.json: the SPA fallback still excludes every /api/* path (unrelated rule, regression guard)', () => {
  const compiled = rewriteTo('/index.html');
  assert.equal(compiled.test('/api/admin/products/create'), false);
  assert.equal(compiled.test('/tienda'), true);
  assert.equal(compiled.test('/'), true);
});

// --- FASE 7F-B1: baseline response security headers ---------------------------
//
// No CSP here by design: a safe Content-Security-Policy needs every real
// origin enumerated first (Supabase project URL, res.cloudinary.com,
// api.cloudinary.com for the signed-upload POST) and careful testing against
// every page, which is a separate phase (7F-A section 18/22). These five are
// unconditionally safe for this SPA: nothing it does needs to be framed by
// another site, sniff a response's MIME type, leak a full referrer
// cross-origin, or use camera/microphone/geolocation/the Payment Request API.

function headerRule(sourcePattern: string) {
  const rule = vercelConfig.headers?.find((entry) => entry.source === sourcePattern);
  assert.ok(rule, `expected a vercel.json headers rule for source ${sourcePattern}`);
  return rule!.headers;
}

function headerValue(headers: Array<{ key: string; value: string }>, key: string) {
  return headers.find((h) => h.key === key)?.value;
}

test('vercel.json: a global headers rule applies to every path, including /api/*', () => {
  const rule = vercelConfig.headers?.find((entry) => entry.source === '/(.*)');
  assert.ok(rule, 'expected a vercel.json headers rule for source /(.*)');
  const compiled = new RegExp(`^${rule!.source}$`);
  for (const path of ['/', '/tienda', '/admin', '/api/checkout', '/api/admin/products/create']) {
    assert.equal(compiled.test(path), true, `${path} should be covered by the global security headers rule`);
  }
});

test('vercel.json: X-Content-Type-Options is nosniff', () => {
  assert.equal(headerValue(headerRule('/(.*)'), 'X-Content-Type-Options'), 'nosniff');
});

test('vercel.json: X-Frame-Options is DENY (nothing in this app is ever framed by another site)', () => {
  assert.equal(headerValue(headerRule('/(.*)'), 'X-Frame-Options'), 'DENY');
});

test('vercel.json: Referrer-Policy is strict-origin-when-cross-origin', () => {
  assert.equal(headerValue(headerRule('/(.*)'), 'Referrer-Policy'), 'strict-origin-when-cross-origin');
});

test('vercel.json: Permissions-Policy disables camera/microphone/geolocation/payment, none of which this app uses', () => {
  const value = headerValue(headerRule('/(.*)'), 'Permissions-Policy');
  for (const feature of ['camera=()', 'microphone=()', 'geolocation=()', 'payment=()']) {
    assert.match(value ?? '', new RegExp(feature.replace(/[()]/g, '\\$&')));
  }
});

test('vercel.json: Strict-Transport-Security has a real max-age and includeSubDomains', () => {
  const value = headerValue(headerRule('/(.*)'), 'Strict-Transport-Security');
  assert.match(value ?? '', /max-age=\d{6,}/);
  assert.match(value ?? '', /includeSubDomains/);
});

test('vercel.json: no Content-Security-Policy yet -- deliberately deferred to its own phase, not shipped half-done', () => {
  const headers = headerRule('/(.*)');
  assert.equal(headerValue(headers, 'Content-Security-Policy'), undefined);
});

test('api/admin dynamic routing uses nested single segments, not a catch-all', () => {
  const adminDir = join(projectRoot, 'api', 'admin');
  const categoryDir = join(adminDir, '[category]');
  assert.equal(existsSync(join(categoryDir, '[action].ts')), true, 'expected api/admin/[category]/[action].ts to exist');

  // A catch-all ([...x]) anywhere under api/ compiles, on this zero-config
  // Vite build, to a single-path-segment regex and silently stops matching
  // any multi-segment route -- exactly bug (2) above. Fail loudly if one
  // reappears anywhere in the API tree.
  function catchAllFiles(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) return catchAllFiles(full);
      return entry.name.includes('[...') ? [full] : [];
    });
  }

  assert.deepEqual(catchAllFiles(join(projectRoot, 'api')), [], 'no catch-all ([...x]) route files are allowed under api/ on this build');
});
