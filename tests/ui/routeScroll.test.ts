import assert from 'node:assert/strict';
import test from 'node:test';

import { ANCHOR_SCROLL_MAX_RETRIES, decideScrollAction } from '../../src/lib/routeScroll';

// --- 1/2/3/4. the three real navbar transitions from the bug report ---------

test('1. / -> /tienda (PUSH, no hash): scrollTo(0,0), behavior "auto"', () => {
  assert.deepEqual(decideScrollAction('/tienda', '', 'PUSH'), { kind: 'top' });
});

test('2. /tienda -> /soporte (PUSH, no hash): scrollTo(0,0)', () => {
  assert.deepEqual(decideScrollAction('/soporte', '', 'PUSH'), { kind: 'top' });
});

test('3. /soporte -> / (PUSH, no hash): scrollTo(0,0)', () => {
  assert.deepEqual(decideScrollAction('/', '', 'PUSH'), { kind: 'top' });
});

test('4. any pathname change with no hash resolves to "top", regardless of which route it is', () => {
  for (const pathname of ['/', '/tienda', '/soporte', '/carrito', '/productos/abc-123', '/mi-pedido', '/success', '/failure', '/pending']) {
    assert.deepEqual(decideScrollAction(pathname, '', 'PUSH'), { kind: 'top' }, `expected top for ${pathname}`);
  }
});

// --- 5/6/7. hash / anchors -----------------------------------------------------

test('5. a hash on a fresh navigation never resolves to "top" first -- it resolves directly to "anchor"', () => {
  assert.deepEqual(decideScrollAction('/', '#productos', 'PUSH'), { kind: 'anchor', id: 'productos' });
  assert.deepEqual(decideScrollAction('/tienda', '#contacto', 'PUSH'), { kind: 'anchor', id: 'contacto' });
});

test('6. same pathname, hash changes (e.g. "/" -> "/#productos"): resolves to "anchor", not "top"', () => {
  assert.deepEqual(decideScrollAction('/', '#productos', 'REPLACE'), { kind: 'anchor', id: 'productos' });
});

test('7. hash resolution is purely by id -- "no element found" is a DOM-level fallback the component applies at runtime, not something decideScrollAction itself decides (it only ever sees the hash string)', () => {
  // decideScrollAction has no DOM access by design; confirm it still returns
  // a concrete id for any non-empty hash, so the component always has
  // something to look up before it can fall back.
  assert.deepEqual(decideScrollAction('/', '#this-id-does-not-exist', 'PUSH'), { kind: 'anchor', id: 'this-id-does-not-exist' });
});

test('ANCHOR_SCROLL_MAX_RETRIES is a small, finite bound (never an infinite retry loop)', () => {
  assert.equal(ANCHOR_SCROLL_MAX_RETRIES, 20);
  assert.ok(ANCHOR_SCROLL_MAX_RETRIES > 0 && ANCHOR_SCROLL_MAX_RETRIES < 1000);
});

// --- 8. POP / back-forward: never forced ------------------------------------

test('8. POP (back/forward) never forces scroll, hash or not -- the browser already restores it', () => {
  assert.deepEqual(decideScrollAction('/tienda', '', 'POP'), { kind: 'none' });
  assert.deepEqual(decideScrollAction('/', '#productos', 'POP'), { kind: 'none' });
});

// --- 9. Admin exclusion -------------------------------------------------------

test('9. Admin routes are never touched, regardless of hash or navigation type (Admin lives in its own layout/chrome)', () => {
  assert.deepEqual(decideScrollAction('/admin', '', 'PUSH'), { kind: 'none' });
  assert.deepEqual(decideScrollAction('/admin/pagina', '', 'PUSH'), { kind: 'none' });
  assert.deepEqual(decideScrollAction('/admin/pedidos', '#x', 'PUSH'), { kind: 'none' });
  assert.deepEqual(decideScrollAction('/admin', '', 'POP'), { kind: 'none' });
});

test('Admin exclusion matches the exact segment, not a bare prefix -- a hypothetical "/admin-landing" public page would not be swallowed', () => {
  assert.deepEqual(decideScrollAction('/admin-landing', '', 'PUSH'), { kind: 'top' });
});
