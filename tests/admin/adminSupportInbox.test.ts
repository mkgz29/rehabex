import assert from 'node:assert/strict';
import * as React from 'react';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';

import { AdminSupportPage } from '../../src/admin/pages/AdminSupportPage';
import { NewSupportRequestForm } from '../../src/admin/components/NewSupportRequestForm';
import { SupportRequestList } from '../../src/admin/components/SupportRequestList';
import { SupportRequestDetail, type OrderContextState } from '../../src/admin/components/SupportRequestDetail';
import { UnsavedChangesProvider } from '../../src/admin/unsavedChanges/UnsavedChangesContext';
import type { SupportRequest } from '../../src/services/adminApi';

(globalThis as typeof globalThis & { React: typeof React }).React = React;

// This project's test suite has no DOM/event simulation (no jsdom or
// Testing Library): rendering is react-dom/server's renderToStaticMarkup,
// which captures exactly one synchronous render and never runs a useEffect
// (SSR has no effect phase). That means a live click -> state change ->
// re-render sequence cannot be exercised here. Instead, every distinct state
// a user could land in (loading, error, empty, each status, conflict, each
// order-context outcome, dirty/clean notes) is rendered directly via props,
// and the transition rules themselves are covered as pure functions in
// supportPresentation.test.ts. See the FASE 7C report for the same note.

function renderSupport() {
  return renderToStaticMarkup(React.createElement(UnsavedChangesProvider, null, React.createElement(AdminSupportPage)));
}

test('Soporte: initial render shows a loading state, not an empty or invented list', () => {
  const markup = renderSupport();
  assert.match(markup, /Cargando consultas/);
  assert.doesNotMatch(markup, /No hay consultas/);
});

test('Soporte: header shows the approved title, description, and a "Nueva consulta" action', () => {
  const markup = renderSupport();
  assert.match(markup, />Soporte</);
  assert.match(markup, /Gestioná consultas y seguimiento de clientes\./);
  assert.match(markup, />Nueva consulta</);
});

test('Soporte: filter tabs render exactly the four approved options', () => {
  const markup = renderSupport();
  for (const label of ['Todos', 'Abiertos', 'Respondidos', 'Resueltos']) {
    assert.match(markup, new RegExp(`>${label}<`));
  }
});

test('Soporte: with nothing selected, the list pane is visible and the detail pane is desktop-only (responsive structure)', () => {
  const markup = renderSupport();
  // The list wrapper gets a plain "block" className (always visible) while
  // nothing is selected; the detail wrapper gets "hidden lg:block" so it
  // never forces a two-column layout on a small screen.
  assert.match(markup, /class="block"/);
  assert.match(markup, /class="hidden lg:block"/);
});

test('Soporte: with nothing selected, the detail pane shows the "select a ticket" empty state', () => {
  const markup = renderSupport();
  assert.match(markup, /Seleccioná una consulta/);
});

function supportRequest(overrides: Partial<SupportRequest> = {}): SupportRequest {
  return {
    id: '22222222-2222-4222-8222-222222222222',
    customerName: 'Cliente Real',
    customerEmail: 'cliente@example.test',
    subject: 'No llego mi pedido',
    message: 'Hola, todavia no me llego el pedido que hice la semana pasada.',
    status: 'open',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

// --- SupportRequestList -------------------------------------------------------

function renderList(props: Partial<React.ComponentProps<typeof SupportRequestList>> = {}) {
  return renderToStaticMarkup(
    React.createElement(SupportRequestList, {
      items: null,
      error: null,
      onRetry: () => undefined,
      filter: 'all',
      onFilterChange: () => undefined,
      selectedId: null,
      onSelect: () => undefined,
      ...props,
    }),
  );
}

test('SupportRequestList: loading, error and empty states are distinct and mutually exclusive', () => {
  assert.match(renderList({ items: null }), /Cargando consultas/);
  const errorMarkup = renderList({ items: [], error: 'No pudimos cargar las consultas.' });
  assert.match(errorMarkup, /No pudimos cargar las consultas\./);
  assert.doesNotMatch(errorMarkup, /Cargando consultas/);
  const emptyMarkup = renderList({ items: [] });
  assert.match(emptyMarkup, /No hay consultas para este filtro\./);
});

test('SupportRequestList: a populated list shows customer, subject, preview, date and status badge', () => {
  const markup = renderList({ items: [supportRequest()] });
  assert.match(markup, />Cliente Real</);
  assert.match(markup, />No llego mi pedido</);
  assert.match(markup, /Hola, todavia no me llego/);
  assert.match(markup, />Abierto</);
});

test('SupportRequestList and SupportRequestDetail: a ticket created without a subject shows "Sin asunto", not an empty heading', () => {
  const withoutSubject = supportRequest({ subject: undefined });
  assert.match(renderList({ items: [withoutSubject] }), /Sin asunto/);
  assert.match(renderDetail({ supportRequest: withoutSubject }), /Sin asunto/);
});

test('SupportRequestList: shows a "pedido vinculado" indicator only when order_id is present', () => {
  const withOrder = renderList({ items: [supportRequest({ orderId: '33333333-3333-4333-8333-333333333333' })] });
  assert.match(withOrder, /Pedido vinculado/);
  const withoutOrder = renderList({ items: [supportRequest()] });
  assert.doesNotMatch(withoutOrder, /Pedido vinculado/);
});

test('SupportRequestList: the selected item is visually marked (aria-current)', () => {
  const markup = renderList({ items: [supportRequest()], selectedId: '22222222-2222-4222-8222-222222222222' });
  assert.match(markup, /aria-current="true"/);
});

test('SupportRequestList: the active filter tab is marked aria-selected', () => {
  const markup = renderList({ filter: 'open' });
  assert.match(markup, /role="tab" aria-selected="true"[^>]*>\s*Abiertos/);
});

// --- SupportRequestDetail -----------------------------------------------------

function renderDetail(props: Partial<React.ComponentProps<typeof SupportRequestDetail>> = {}) {
  return renderToStaticMarkup(
    React.createElement(SupportRequestDetail, {
      supportRequest: null,
      loading: false,
      error: null,
      conflict: false,
      orderContext: { status: 'idle' } as OrderContextState,
      onChangeStatus: () => undefined,
      statusSaving: false,
      notesDraft: '',
      onNotesDraftChange: () => undefined,
      onSaveNotes: () => undefined,
      notesSaving: false,
      notesDirty: false,
      onBack: () => undefined,
      actionError: null,
      ...props,
    }),
  );
}

test('SupportRequestDetail: with nothing selected, shows the empty placeholder, not a blank panel', () => {
  const markup = renderDetail();
  assert.match(markup, /Seleccioná una consulta/);
});

test('SupportRequestDetail: loading and error are distinct from the empty placeholder', () => {
  assert.match(renderDetail({ loading: true }), /Cargando consulta/);
  const errorMarkup = renderDetail({ error: 'No pudimos cargar la consulta.' });
  assert.match(errorMarkup, /No pudimos cargar la consulta\./);
  assert.doesNotMatch(errorMarkup, /Seleccioná una consulta/);
});

test('SupportRequestDetail: shows customer name, email and phone only when phone exists', () => {
  const withPhone = renderDetail({ supportRequest: supportRequest({ customerPhone: '+54 9 11 1234-5678' }) });
  assert.match(withPhone, /\+54 9 11 1234-5678/);
  const withoutPhone = renderDetail({ supportRequest: supportRequest() });
  assert.doesNotMatch(withoutPhone, /Telefono/);
});

test('SupportRequestDetail: an open ticket offers "responder"/"resolver" but never "reabrir"', () => {
  const markup = renderDetail({ supportRequest: supportRequest({ status: 'open' }) });
  assert.match(markup, />Marcar respondido</);
  assert.match(markup, />Marcar resuelto</);
  assert.doesNotMatch(markup, />Reabrir</);
});

test('SupportRequestDetail: a resolved ticket offers only "reabrir"', () => {
  const markup = renderDetail({ supportRequest: supportRequest({ status: 'resolved' }) });
  assert.match(markup, />Reabrir</);
  assert.doesNotMatch(markup, />Marcar respondido</);
  assert.doesNotMatch(markup, />Marcar resuelto</);
});

test('SupportRequestDetail: an answered ticket offers "reabrir" and "resolver" but not "responder" again', () => {
  const markup = renderDetail({ supportRequest: supportRequest({ status: 'answered' }) });
  assert.match(markup, />Reabrir</);
  assert.match(markup, />Marcar resuelto</);
  assert.doesNotMatch(markup, />Marcar respondido</);
});

test('SupportRequestDetail: shows the optimistic-concurrency conflict banner only when conflict=true', () => {
  const withConflict = renderDetail({ supportRequest: supportRequest(), conflict: true });
  assert.match(withConflict, /cambió en otra sesión/);
  const withoutConflict = renderDetail({ supportRequest: supportRequest(), conflict: false });
  assert.doesNotMatch(withoutConflict, /cambió en otra sesión/);
});

test('SupportRequestDetail: surfaces an action error (e.g. a failed status change) without crashing', () => {
  const markup = renderDetail({ supportRequest: supportRequest(), actionError: 'No pudimos cambiar el estado.' });
  assert.match(markup, /No pudimos cambiar el estado\./);
});

test('SupportRequestDetail: order context renders loading, error, not_found and ready distinctly', () => {
  const base = { supportRequest: supportRequest({ orderId: '33333333-3333-4333-8333-333333333333' }) };
  assert.match(renderDetail({ ...base, orderContext: { status: 'loading' } }), /Cargando pedido/);
  assert.match(renderDetail({ ...base, orderContext: { status: 'error', message: 'No pudimos cargar el pedido.' } }), /No pudimos cargar el pedido\./);
  assert.match(renderDetail({ ...base, orderContext: { status: 'not_found' } }), /ya no existe/);
  const ready = renderDetail({
    ...base,
    orderContext: {
      status: 'ready',
      order: { id: '33333333-3333-4333-8333-333333333333', order_number: 'RHB-202610-000001', payment_status: 'approved', order_status: 'confirmed', fulfillment_status: 'shipped' },
    },
  });
  assert.match(ready, /RHB-202610-000001/);
  assert.match(ready, /Pago aprobado/);
  assert.match(ready, /Confirmado/);
  assert.match(ready, /Enviado/);
});

test('SupportRequestDetail: no order section renders at all when the ticket has no order_id (idle)', () => {
  const markup = renderDetail({ supportRequest: supportRequest(), orderContext: { status: 'idle' } });
  assert.doesNotMatch(markup, /Pedido relacionado/);
});

test('SupportRequestDetail: the notes textarea is pre-filled from notesDraft, and "Guardar nota" is disabled unless dirty', () => {
  const clean = renderDetail({ supportRequest: supportRequest(), notesDraft: 'Nota existente', notesDirty: false });
  assert.match(clean, /Nota existente/);
  assert.match(clean, /<button[^>]*disabled=""[^>]*>Guardar nota/);
  const dirty = renderDetail({ supportRequest: supportRequest(), notesDraft: 'Nota nueva', notesDirty: true });
  assert.doesNotMatch(dirty, /<button[^>]*disabled=""[^>]*>Guardar nota/);
});

// --- NewSupportRequestForm -----------------------------------------------------

function renderCreateForm() {
  return renderToStaticMarkup(
    React.createElement(
      UnsavedChangesProvider,
      null,
      React.createElement(NewSupportRequestForm, { onCreated: () => undefined, onCancel: () => undefined }),
    ),
  );
}

test('NewSupportRequestForm: renders every field with the limits matching server/admin/validators.ts, and Asunto is optional', () => {
  const markup = renderCreateForm();
  assert.match(markup, />Nombre \*</);
  assert.match(markup, />Email \*</);
  assert.match(markup, />Telefono</);
  assert.match(markup, />Pedido relacionado</);
  assert.match(markup, />Asunto</);
  assert.doesNotMatch(markup, />Asunto \*</);
  assert.match(markup, />Mensaje \*</);
  assert.match(markup, /maxLength="160"/); // customerName
  assert.match(markup, /maxLength="40"/); // customerPhone
  assert.match(markup, /maxLength="200"/); // subject
  assert.match(markup, /maxLength="4000"/); // message
});

test('NewSupportRequestForm: the order field is a free-text input backed by a datalist, not a raw id field', () => {
  const markup = renderCreateForm();
  assert.match(markup, /list="support-order-suggestions"/);
  assert.match(markup, /<datalist id="support-order-suggestions">/);
});

test('NewSupportRequestForm: has Crear consulta / Cancelar actions', () => {
  const markup = renderCreateForm();
  assert.match(markup, />Crear consulta</);
  assert.match(markup, />Cancelar</);
});
