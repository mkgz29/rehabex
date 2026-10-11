import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as React from 'react';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';

import { WhatsAppContactButton, WhatsAppContactView } from '../../src/admin/components/WhatsAppContactButton.tsx';
import { resolveWhatsAppOrderReference, type OrderContextState } from '../../src/admin/components/SupportRequestDetail.tsx';
import { buildSupportWhatsAppMessage, buildWhatsAppUrl } from '../../src/admin/whatsapp.ts';
import type { SupportRequest } from '../../src/services/adminApi';

(globalThis as typeof globalThis & { React: typeof React }).React = React;

// Same constraint as the rest of this suite: no DOM/event simulation. The
// container (WhatsAppContactButton) owns isOpen/message as local state, so
// its "click to expand" / "edit the textarea" behavior is exercised through
// the pure, prop-driven WhatsAppContactView instead -- rendered directly
// with the exact props a real click or keystroke would have produced.

function renderContainer(props: Partial<React.ComponentProps<typeof WhatsAppContactButton>> = {}) {
  return renderToStaticMarkup(
    React.createElement(WhatsAppContactButton, { phone: undefined, customerName: 'Cliente Real', ...props }),
  );
}

function renderView(props: Partial<React.ComponentProps<typeof WhatsAppContactView>> = {}) {
  return renderToStaticMarkup(
    React.createElement(WhatsAppContactView, {
      isOpen: false,
      message: '',
      url: null,
      textareaId: 'whatsapp-message',
      onToggle: () => undefined,
      onMessageChange: () => undefined,
      onCancel: () => undefined,
      ...props,
    }),
  );
}

// --- container: phone presence/validity (A, B, C) ----------------------------

test('A. a valid phone renders the collapsed "Contactar por WhatsApp" button', () => {
  const markup = renderContainer({ phone: '+54 9 381 555 1234' });
  assert.match(markup, />Contactar por WhatsApp</);
  assert.doesNotMatch(markup, /<textarea/);
});

test('B. no phone at all renders nothing', () => {
  assert.equal(renderContainer({ phone: undefined }), '');
  assert.equal(renderContainer({ phone: null }), '');
  assert.equal(renderContainer({ phone: '' }), '');
});

test('C. a phone that does not normalize shows a discreet notice, never a wa.me link or a button', () => {
  const markup = renderContainer({ phone: '381 5551234' });
  assert.match(markup, /No se pudo abrir WhatsApp con este número\./);
  assert.doesNotMatch(markup, /Contactar por WhatsApp/);
  assert.doesNotMatch(markup, /wa\.me/i);
});

// --- view: expand/collapse (D, K) ---------------------------------------------

test('D. closed state: only the toggle button, no textarea or actions', () => {
  const markup = renderView({ isOpen: false });
  assert.doesNotMatch(markup, /<textarea/);
  assert.doesNotMatch(markup, />Abrir WhatsApp</);
  assert.doesNotMatch(markup, />Cancelar</);
  assert.match(markup, /aria-expanded="false"/);
});

test('D/K. open state: shows the editable textarea, "Abrir WhatsApp" and "Cancelar"', () => {
  const markup = renderView({ isOpen: true, message: 'Hola', url: 'https://wa.me/5493815551234?text=Hola' });
  assert.match(markup, /aria-expanded="true"/);
  assert.match(markup, /<textarea/);
  assert.match(markup, />Abrir WhatsApp</);
  assert.match(markup, />Cancelar</);
});

// --- messages (E, F, G) via the pure resolver + the already-tested builder ---

const baseSupportRequest: SupportRequest = {
  id: '22222222-2222-4222-8222-222222222222',
  customerName: 'Ana',
  customerEmail: 'ana@example.test',
  message: 'Hola',
  status: 'open',
  source: 'admin',
  topic: 'general',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

test('E. no order anywhere: resolves to the base support message', () => {
  const reference = resolveWhatsAppOrderReference({ status: 'idle' }, baseSupportRequest);
  assert.equal(reference, null);
  assert.equal(buildSupportWhatsAppMessage('Ana', reference), 'Hola Ana, somos de Rehabex. Te contactamos por tu consulta.');
});

test('F. only a free-text orderReference: used in the message', () => {
  const ticket: SupportRequest = { ...baseSupportRequest, orderReference: 'RHB-202610-000099' };
  const reference = resolveWhatsAppOrderReference({ status: 'idle' }, ticket);
  assert.equal(reference, 'RHB-202610-000099');
  assert.equal(
    buildSupportWhatsAppMessage('Ana', reference),
    'Hola Ana, somos de Rehabex. Te contactamos por tu consulta sobre el pedido RHB-202610-000099.',
  );
});

test('G. a real linked order takes priority over the free-text orderReference', () => {
  const ticket: SupportRequest = { ...baseSupportRequest, orderId: '33333333-3333-4333-8333-333333333333', orderReference: 'texto-libre-viejo' };
  const orderContext: OrderContextState = {
    status: 'ready',
    order: { id: '33333333-3333-4333-8333-333333333333', order_number: 'RHB-202610-000001' },
  };
  const reference = resolveWhatsAppOrderReference(orderContext, ticket);
  assert.equal(reference, 'RHB-202610-000001');
  assert.doesNotMatch(buildSupportWhatsAppMessage('Ana', reference), /texto-libre-viejo/);
});

test('G2. a real linked order with no order_number yet falls back to null, not the free-text reference', () => {
  const ticket: SupportRequest = { ...baseSupportRequest, orderReference: 'texto-libre' };
  const orderContext: OrderContextState = { status: 'ready', order: { id: '33333333-3333-4333-8333-333333333333', order_number: null } };
  assert.equal(resolveWhatsAppOrderReference(orderContext, ticket), null);
});

// --- textarea is editable, controlled by external state (H) ------------------

test('H. the textarea reflects whatever message it is given (controlled input)', () => {
  const markup = renderView({ isOpen: true, message: 'Mensaje editado a mano', url: null });
  assert.match(markup, />Mensaje editado a mano<\/textarea>/);
});

test('H. the textarea has a real label pointing at it via htmlFor/id, not a bare placeholder', () => {
  const markup = renderView({ isOpen: true, message: '', url: null, textareaId: 'wa-msg-1' });
  assert.match(markup, /<label for="wa-msg-1"[^>]*>Mensaje de WhatsApp<\/label>/);
  assert.match(markup, /<textarea id="wa-msg-1"/);
});

test('CONTRACT: the textarea onChange is wired to onMessageChange, not left read-only', () => {
  const source = readFileSync(join(process.cwd(), 'src/admin/components/WhatsAppContactButton.tsx'), 'utf8');
  assert.match(source, /onChange=\{\(event\) => onMessageChange\(event\.target\.value\)\}/);
});

// --- href generated by buildWhatsAppUrl (I, J) --------------------------------

test('I. the "Abrir WhatsApp" link href is exactly whatever buildWhatsAppUrl produced', () => {
  const url = buildWhatsAppUrl('+54 9 381 555 1234', 'Hola, probando')!;
  const markup = renderView({ isOpen: true, message: 'Hola, probando', url });
  assert.match(markup, new RegExp(`href="${url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`));
});

test('J. accents, punctuation and symbols in the message survive correctly encoded in the href', () => {
  const message = 'Hola José, ¿cómo estás? Pedido & referencia';
  const url = buildWhatsAppUrl('+54 9 381 555 1234', message)!;
  const markup = renderView({ isOpen: true, message, url });
  const hrefMatch = /href="([^"]*)"/.exec(markup);
  assert.ok(hrefMatch, 'expected an href attribute on the "Abrir WhatsApp" link');
  const decoded = new URL(hrefMatch![1].replace(/&amp;/g, '&')).searchParams.get('text');
  assert.equal(decoded, message);
});

test('a null url (should not normally happen once the container has already validated the phone) never renders a literal href="null"', () => {
  const markup = renderView({ isOpen: true, message: 'Hola', url: null });
  assert.doesNotMatch(markup, /href="null"/);
});

// --- accessibility (no div-as-button, real controls) --------------------------

test('ACCESSIBILITY: toggle, "Abrir WhatsApp" and "Cancelar" are all real interactive elements, never a bare clickable div', () => {
  const closed = renderView({ isOpen: false });
  assert.match(closed, /<button[^>]*aria-expanded="false"[^>]*>\s*Contactar por WhatsApp/);
  const open = renderView({ isOpen: true, message: 'Hola', url: 'https://wa.me/5493815551234?text=Hola' });
  assert.match(open, /<a[^>]*href="https:\/\/wa\.me/);
  assert.match(open, /<button[^>]*>\s*Cancelar/);
});

// --- security contract (M) -----------------------------------------------------

test('SECURITY CONTRACT: WhatsAppContactButton.tsx never imports fetch/adminApi/Supabase and never calls a status/notes mutation', () => {
  const content = readFileSync(join(process.cwd(), 'src/admin/components/WhatsAppContactButton.tsx'), 'utf8');
  assert.doesNotMatch(content, /from ['"]@supabase|createClient|\.rpc\(/);
  assert.doesNotMatch(content, /adminApi|updateSupportRequestStatus|updateSupportRequestNotes/);
  assert.doesNotMatch(content, /\bfetch\(/);
});

test('SECURITY CONTRACT: opening WhatsApp is a plain <a target="_blank" rel="noopener noreferrer">, never a click handler that calls an API', () => {
  const content = readFileSync(join(process.cwd(), 'src/admin/components/WhatsAppContactButton.tsx'), 'utf8');
  assert.match(content, /<a href=\{url[^}]*\} target="_blank" rel="noopener noreferrer"/);
});
