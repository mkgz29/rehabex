import assert from 'node:assert/strict';
import * as React from 'react';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';

import { OrderWhatsAppAction } from '../../src/admin/components/OrdersTable';
import type { AdminOrder } from '../../src/admin/orderPresentation';

(globalThis as typeof globalThis & { React: typeof React }).React = React;

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

test('shows the action for an order with a valid phone and a customer name', () => {
  const markup = render(BASE);
  assert.match(markup, /aria-label="Contactar a Juan Perez por WhatsApp"/);
  assert.match(markup, /href="https:\/\/wa\.me\/5493815551234/);
});

test('the icon-only link has an accessible name naming the actual customer, not a generic label', () => {
  const markup = render({ ...BASE, customer_name: 'Maria Gomez' });
  assert.match(markup, /aria-label="Contactar a Maria Gomez por WhatsApp"/);
  assert.doesNotMatch(markup, /aria-label="Contactar por WhatsApp"/);
});

test('renders nothing when there is no phone', () => {
  const markup = render({ ...BASE, customer_phone: null });
  assert.equal(markup, '');
});

test('renders nothing when there is no customer name (never greets a stranger)', () => {
  const markup = render({ ...BASE, customer_name: null });
  assert.equal(markup, '');
});

test('renders nothing -- not a disabled/fallback control -- when the phone cannot be normalized', () => {
  const markup = render({ ...BASE, customer_phone: '381 5551234' });
  assert.equal(markup, '');
});

test('the preloaded message uses the order_number template', () => {
  const markup = render(BASE);
  const href = /href="([^"]+)"/.exec(markup)?.[1] ?? '';
  const url = new URL(href.replace(/&amp;/g, '&'));
  assert.equal(url.searchParams.get('text'), 'Hola Juan Perez, somos Rehabex. Te escribimos por tu pedido RHB-202610-000047.');
});

test('the URL never contains email, payment id, or internal status fields', () => {
  const markup = render({ ...BASE, payment_status: 'approved', order_status: 'confirmed', mercadopago_payment_id: 'mp-123456' });
  const href = /href="([^"]+)"/.exec(markup)?.[1] ?? '';
  assert.doesNotMatch(href, /@/);
  assert.doesNotMatch(href, /mp-123456/);
  assert.doesNotMatch(href, /approved|confirmed/);
});

test('opens in a new tab with noopener/noreferrer, never same-tab navigation', () => {
  const markup = render(BASE);
  assert.match(markup, /target="_blank"/);
  assert.match(markup, /rel="noopener noreferrer"/);
});
