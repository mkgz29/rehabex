import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as React from 'react';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

import { SupportIntakePage, SupportIntakeView } from '../../src/pages/SupportIntakePage.tsx';
import { SUPPORT_TOPIC_LABELS, SUPPORT_TOPICS } from '../../src/support/supportTopics.ts';

(globalThis as typeof globalThis & { React: typeof React }).React = React;

// Same constraint as the rest of this project's test suite: no DOM/event
// simulation (no jsdom), so a live click -> submit -> fetch sequence cannot
// be exercised here. SupportIntakePage is split into a stateful container
// and a pure, prop-driven SupportIntakeView (same pattern as
// SupportRequestDetail/AdminSupportPage) specifically so every reachable
// state -- idle, submitting, success, error, error with a 429 message -- can
// be rendered directly via props. The fetch call itself (payload shape,
// method, error mapping) is covered in tests/support/publicApi.test.ts.
//
// The route itself is checked by reading src/App.tsx's source rather than
// rendering <App/>: App.tsx transitively imports payment-brand SVGs (via
// CartPage/PaymentMethods), which Vite handles as asset imports but a bare
// `tsx --test` run outside Vite cannot load -- the same reason no other
// test in this suite renders <App/> directly.

function renderIdlePage() {
  return renderToStaticMarkup(React.createElement(MemoryRouter, { initialEntries: ['/soporte'] }, React.createElement(SupportIntakePage)));
}

const emptyValues = { topic: '' as const, customerName: '', customerEmail: '', customerPhone: '', orderReference: '', subject: '', message: '' };

function renderView(props: Partial<React.ComponentProps<typeof SupportIntakeView>> = {}) {
  return renderToStaticMarkup(
    React.createElement(
      MemoryRouter,
      null,
      React.createElement(SupportIntakeView, {
        status: 'idle',
        errorMessage: null,
        values: emptyValues,
        onFieldChange: () => undefined,
        honeypotValue: '',
        onHoneypotChange: () => undefined,
        onSubmit: () => undefined,
        ...props,
      }),
    ),
  );
}

// --- route -------------------------------------------------------------------

test('/soporte is wired into App.tsx as a public route mapped to SupportIntakePage, not nested under /admin', () => {
  const appSource = readFileSync(join(process.cwd(), 'src/App.tsx'), 'utf8');
  assert.match(appSource, /import \{ SupportIntakePage \} from '\.\/pages\/SupportIntakePage';/);
  assert.match(appSource, /<Route path="\/soporte" element=\{<SupportIntakePage \/>\} \/>/);

  const soporteIndex = appSource.indexOf('path="/soporte"');
  const adminBlockIndex = appSource.indexOf('path="/admin"');
  assert.ok(soporteIndex > -1 && adminBlockIndex > -1 && soporteIndex < adminBlockIndex, '/soporte must be a top-level route, declared before the /admin ProtectedRoute block, not nested inside it');
});

test('/soporte requires no authentication: rendering the page directly, with no AuthContext/session at all, produces the real form', () => {
  const markup = renderToStaticMarkup(
    React.createElement(MemoryRouter, { initialEntries: ['/soporte'] }, React.createElement(Routes, null, React.createElement(Route, { path: '/soporte', element: React.createElement(SupportIntakePage) }))),
  );
  assert.match(markup, /Enviar consulta/);
});

// --- fields / topics / limits --------------------------------------------------

test('the idle page renders the approved heading, eyebrow and intro copy', () => {
  const markup = renderIdlePage();
  assert.match(markup, /Consultas Rehabex/);
  assert.match(markup, /¿Necesitás ayuda\?/);
  assert.match(markup, />Enviar consulta</);
});

test('every required field is present with a real label', () => {
  const markup = renderIdlePage();
  for (const label of ['Motivo de consulta', 'Nombre', 'Email', 'Teléfono', 'Número de pedido', 'Asunto', 'Mensaje']) {
    assert.match(markup, new RegExp(label));
  }
});

test('all 8 topics render as select options, with the approved Spanish labels', () => {
  const markup = renderIdlePage();
  assert.equal(SUPPORT_TOPICS.length, 8);
  for (const topic of SUPPORT_TOPICS) {
    assert.match(markup, new RegExp(`<option value="${topic}">${SUPPORT_TOPIC_LABELS[topic].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}</option>`));
  }
});

test('field length limits match the public backend: 160/254/40/200/60/4000', () => {
  const markup = renderIdlePage();
  for (const limit of [160, 254, 40, 200, 60, 4000]) {
    assert.match(markup, new RegExp(`maxLength="${limit}"`), `expected a field with maxLength ${limit}`);
  }
});

test('order reference is a free-text input, never asks for a UUID', () => {
  const markup = renderIdlePage();
  assert.doesNotMatch(markup, /pattern=".*uuid.*"/i);
});

test('the honeypot field is present, out of the normal visual flow, and hidden from assistive tech', () => {
  const markup = renderIdlePage();
  assert.match(markup, /name="form_guard"/);
  assert.match(markup, /aria-hidden="true"[^>]*>[\s\S]*name="form_guard"/);
  assert.match(markup, /tabIndex=-1|tabindex="-1"/);
});

test('no explanation or mention of the honeypot is ever shown to the user', () => {
  const markup = renderIdlePage();
  assert.doesNotMatch(markup, /honeypot|anti-spam|anti spam|bot detection/i);
});

test('FASE 7D.1-E: the honeypot field name is non-semantic -- never matches a real form-field name that could trigger browser/password-manager autofill', () => {
  const markup = renderIdlePage();
  assert.doesNotMatch(markup, /name="company"/);
  for (const semanticName of ['company', 'organization', 'website', 'url', 'address', 'phone', 'email', 'name']) {
    assert.doesNotMatch(markup, new RegExp(`name="${semanticName}"`), `honeypot name must never be "${semanticName}"`);
  }
});

// --- UX states (via the pure view) --------------------------------------------

test('idle: the submit button is enabled and reads "Enviar consulta"', () => {
  const markup = renderView({ status: 'idle' });
  // The placeholder <option disabled> ("Elegí un motivo") is intentional and
  // unrelated; only the submit button's own disabled state matters here.
  assert.doesNotMatch(markup, /<button[^>]*disabled=""[^>]*>/);
  assert.match(markup, />Enviar consulta</);
});

test('submitting: the submit button is disabled (blocks double-submit) and shows feedback', () => {
  const markup = renderView({ status: 'submitting' });
  assert.match(markup, /<button[^>]*disabled=""[^>]*>\s*Enviando/);
});

test('success: shows the approved message, no UUID/ticket id anywhere, and a "Volver al inicio" link', () => {
  const markup = renderView({ status: 'success' });
  assert.match(markup, /Recibimos tu consulta\./);
  assert.match(markup, /Nuestro equipo te responderá a la brevedad\./);
  assert.match(markup, />Volver al inicio</);
  assert.doesNotMatch(markup, /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i, 'no UUID must ever be shown to the public user');
  assert.doesNotMatch(markup, /<form/, 'the form must not still be mounted on success');
});

test('error: shows a simple message, never a raw backend error', () => {
  const markup = renderView({ status: 'error', errorMessage: 'No pudimos enviar tu consulta. Intentá nuevamente en unos minutos.' });
  assert.match(markup, /role="alert"/);
  assert.match(markup, /No pudimos enviar tu consulta\./);
  assert.doesNotMatch(markup, /SQLSTATE|ADM22|ADM29|postgres/i);
});

test('error: a 429-specific message is simple and distinct from the generic one', () => {
  const markup = renderView({ status: 'error', errorMessage: 'Enviaste varias consultas en poco tiempo. Intentá nuevamente en unos minutos.' });
  assert.match(markup, /Enviaste varias consultas en poco tiempo\./);
});

// --- security contract ---------------------------------------------------------

test('SECURITY CONTRACT: the public page never imports adminApi or any Supabase client', () => {
  const content = readFileSync(join(process.cwd(), 'src/pages/SupportIntakePage.tsx'), 'utf8');
  assert.doesNotMatch(content, /adminApi|supabase/i);
});
