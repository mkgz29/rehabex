import assert from 'node:assert/strict';
import test from 'node:test';

import { decideScrollAction } from '../../src/lib/routeScroll';

// --- the scenarios from the bug report -----------------------------------

test('Inicio -> Tienda (PUSH, no hash): scroll to top', () => {
  assert.deepEqual(decideScrollAction('/tienda', '', 'PUSH'), { kind: 'top' });
});

test('Tienda -> Soporte (PUSH, no hash): scroll to top', () => {
  assert.deepEqual(decideScrollAction('/soporte', '', 'PUSH'), { kind: 'top' });
});

test('Soporte -> Inicio (PUSH, no hash): scroll to top', () => {
  assert.deepEqual(decideScrollAction('/', '', 'PUSH'), { kind: 'top' });
});

test('any public pathname with no hash resolves to "top" regardless of which route it is', () => {
  for (const pathname of ['/', '/tienda', '/soporte', '/carrito', '/productos/abc-123', '/mi-pedido']) {
    assert.deepEqual(decideScrollAction(pathname, '', 'PUSH'), { kind: 'top' }, `expected top for ${pathname}`);
  }
});

// --- hash / anchors --------------------------------------------------------

test('a hash on any route never forces top -- it resolves to "anchor" with that id', () => {
  assert.deepEqual(decideScrollAction('/', '#productos', 'PUSH'), { kind: 'anchor', id: 'productos' });
  assert.deepEqual(decideScrollAction('/soporte', '#formulario', 'PUSH'), { kind: 'anchor', id: 'formulario' });
});

test('REPLACE with a hash still resolves to "anchor", same as PUSH', () => {
  assert.deepEqual(decideScrollAction('/', '#contacto', 'REPLACE'), { kind: 'anchor', id: 'contacto' });
});

// --- back/forward ------------------------------------------------------------

test('POP (back/forward) never forces scroll, hash or not -- the browser already restores it', () => {
  assert.deepEqual(decideScrollAction('/tienda', '', 'POP'), { kind: 'none' });
  assert.deepEqual(decideScrollAction('/', '#productos', 'POP'), { kind: 'none' });
});

// --- Admin exclusion ---------------------------------------------------------

test('Admin routes are never touched, regardless of hash or navigation type', () => {
  assert.deepEqual(decideScrollAction('/admin', '', 'PUSH'), { kind: 'none' });
  assert.deepEqual(decideScrollAction('/admin/pagina', '', 'PUSH'), { kind: 'none' });
  assert.deepEqual(decideScrollAction('/admin/pedidos', '#x', 'PUSH'), { kind: 'none' });
  assert.deepEqual(decideScrollAction('/admin', '', 'POP'), { kind: 'none' });
});

test('Admin exclusion matches the exact segment, not a bare prefix -- a hypothetical "/admin-landing" public page would not be swallowed', () => {
  assert.deepEqual(decideScrollAction('/admin-landing', '', 'PUSH'), { kind: 'top' });
});
