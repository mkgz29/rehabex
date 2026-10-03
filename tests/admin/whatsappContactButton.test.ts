import assert from 'node:assert/strict';
import * as React from 'react';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';

import { WhatsAppContactButton } from '../../src/admin/components/WhatsAppContactButton';

(globalThis as typeof globalThis & { React: typeof React }).React = React;

function render(props: Partial<React.ComponentProps<typeof WhatsAppContactButton>> = {}) {
  return renderToStaticMarkup(
    React.createElement(WhatsAppContactButton, {
      phone: '+54 9 381 555 1234',
      customerName: 'Juan Perez',
      orderNumber: null,
      ...props,
    }),
  );
}

test('renders nothing at all when there is no phone', () => {
  const markup = render({ phone: undefined });
  assert.equal(markup, '');
});

test('shows "Abrir WhatsApp" for a normalizable number', () => {
  const markup = render({ phone: '+54 9 381 555 1234' });
  assert.match(markup, />\s*Abrir WhatsApp</);
});

test('shows a discreet message, not the button, for a phone that exists but cannot be normalized -- never hides the situation', () => {
  const markup = render({ phone: '381 5551234' });
  assert.doesNotMatch(markup, />\s*Abrir WhatsApp</);
  assert.match(markup, /No se pudo abrir WhatsApp con este número\./);
});

test('preloads the no-order template when there is no related order', () => {
  const markup = render({ customerName: 'Juan Perez', orderNumber: null });
  assert.match(markup, /Hola Juan Perez, somos Rehabex\. Te escribimos por tu consulta\./);
});

test('preloads the order template, with the order number, when a related order exists', () => {
  const markup = render({ customerName: 'Juan Perez', orderNumber: 'RHB-202610-000047' });
  assert.match(markup, /Hola Juan Perez, somos Rehabex\. Te escribimos por tu pedido RHB-202610-000047\./);
});

test('the message is in an editable textarea, not static text', () => {
  const markup = render();
  assert.match(markup, /<textarea[^>]*>Hola Juan Perez/);
});

test('never renders an email, internal status, internal notes, or a payment id', () => {
  const markup = render({ orderNumber: 'RHB-202610-000047' });
  assert.doesNotMatch(markup, /@/);
  for (const forbidden of ['payment', 'nota interna', 'status', 'resolved', 'answered']) {
    assert.doesNotMatch(markup.toLowerCase(), new RegExp(forbidden));
  }
});

// Clicking "Abrir WhatsApp" calls window.open directly inside the click
// handler; this project's test suite has no DOM/event simulation (no
// jsdom/Testing Library -- see the FASE 7C report for the same limit), so
// that a click never mutates ticket status or creates a support record is
// guaranteed structurally instead: the component's own props are exactly
// { phone, customerName, orderNumber } (see the type above this file
// imports), so there is no status-changing or record-creating function it
// could even call.
