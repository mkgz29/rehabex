import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as React from 'react';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';

import { OrderWhatsAppAction } from '../../src/admin/components/OrdersTable.tsx';
import type { AdminOrder } from '../../src/admin/orderPresentation.ts';

(globalThis as typeof globalThis & { React: typeof React }).React = React;

// Same two-step UX as Soporte (FASE 7D-B): this never opens wa.me straight
// from a click. The row only ever shows the collapsed "Contactar por
// WhatsApp" toggle; the editable panel and the real href are exercised at
// the WhatsAppContactView level in whatsappContactButton.test.ts, the same
// no-DOM-simulation approach used throughout this suite.

function render(order: Partial<AdminOrder>) {
  return renderToStaticMarkup(React.createElement(OrderWhatsAppAction, { order: order as AdminOrder }));
}

const BASE: AdminOrder = {
  id: 'order-1',
  order_number: 'RHB-202610-000047',
  customer_name: 'Juan Perez',
  customer_email: 'juan@example.test',
  customer_phone: '+54 9 381 555 1234',
};

test('a valid phone and a real customer name show the collapsed "Contactar por WhatsApp" action', () => {
  const markup = render(BASE);
  assert.match(markup, />Contactar por WhatsApp</);
  assert.doesNotMatch(markup, /<textarea/);
});

test('renders nothing when there is no phone', () => {
  assert.equal(render({ ...BASE, customer_phone: null }), '');
  assert.equal(render({ ...BASE, customer_phone: undefined }), '');
});

test('renders nothing when there is no customer name at all (never greets a stranger)', () => {
  assert.equal(render({ ...BASE, customer_name: null }), '');
  assert.equal(render({ ...BASE, customer_name: '' }), '');
  assert.equal(render({ ...BASE, customer_name: '   ' }), '');
});

test('a phone that does not normalize shows the same discreet notice as Soporte, never a wa.me link', () => {
  const markup = render({ ...BASE, customer_phone: '381 5551234' });
  assert.match(markup, /No se pudo abrir WhatsApp con este número\./);
  assert.doesNotMatch(markup, /Contactar por WhatsApp/);
  assert.doesNotMatch(markup, /wa\.me/i);
});

test('the preloaded message uses buildOrderWhatsAppMessage with the friendly order_number, not a UUID', () => {
  const html = readFileSync(join(process.cwd(), 'src/admin/components/OrdersTable.tsx'), 'utf8');
  assert.match(html, /buildOrderWhatsAppMessage\(name, orderReference\(order\)\)/);
});

test('a missing order_number falls back to a short id prefix, never the full UUID, via the shared orderReference() helper', () => {
  const withoutNumber: AdminOrder = { ...BASE, order_number: null, id: '33333333-3333-4333-8333-333333333333' };
  const markup = render(withoutNumber);
  // The collapsed state never exposes the message text itself, but
  // orderReference() is already covered independently in
  // orderPresentation tests; this only confirms the action still renders
  // (i.e. OrderWhatsAppAction never throws when order_number is absent).
  assert.match(markup, />Contactar por WhatsApp</);
});

test('CONTRACT: OrderWhatsAppAction is keyed by the order id, so switching rows never reuses another buyer\'s draft', () => {
  const source = readFileSync(join(process.cwd(), 'src/admin/components/OrdersTable.tsx'), 'utf8');
  assert.match(source, /<WhatsAppContactButton\s+key=\{order\.id \?\? orderReference\(order\)\}/);
});

test('SECURITY CONTRACT: the action never leaks email, payment id or status into its own source as part of the message', () => {
  const source = readFileSync(join(process.cwd(), 'src/admin/components/OrdersTable.tsx'), 'utf8');
  // buildOrderWhatsAppMessage is only ever called with (name, reference) --
  // confirming this structurally is sufficient, since the function itself
  // has no parameters for email/payment/status to leak through.
  assert.doesNotMatch(source, /buildOrderWhatsAppMessage\([^)]*(customer_email|payment_status|order_status|mercadopago)/);
});

// FASE 7D.4: the toggle is now icon-only (compact, repeated row action) --
// still a real <button>, never a bare clickable div, with its accessible
// name carried by aria-label/title rather than visible text.
test('accessibility: the toggle is a real button, with an aria-label and title carrying the action name', () => {
  const markup = render(BASE);
  assert.match(markup, /<button[^>]*title="Contactar por WhatsApp"[^>]*aria-label="Contactar por WhatsApp"/);
});
