import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
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
// supportPresentation.test.ts.

function renderSupport() {
  return renderToStaticMarkup(React.createElement(UnsavedChangesProvider, null, React.createElement(AdminSupportPage)));
}

test('Soporte: initial render shows a loading state, not an empty or invented list', () => {
  const markup = renderSupport();
  assert.match(markup, /Cargando consultas/);
  assert.doesNotMatch(markup, /No hay consultas/);
});

test('Soporte: header shows the approved title, description, and a "Registrar consulta" action', () => {
  const markup = renderSupport();
  assert.match(markup, />Soporte</);
  assert.match(markup, /Gestioná consultas y seguimiento de clientes\./);
  assert.match(markup, />Registrar consulta</);
});

test('Soporte: filter tabs render exactly the five approved options, in Spanish, feminine plural (FASE 7D.2: Archivadas added)', () => {
  const markup = renderSupport();
  for (const label of ['Todas', 'Abiertas', 'Respondidas', 'Resueltas', 'Archivadas']) {
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
    source: 'admin',
    topic: 'general',
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
      onRefresh: () => undefined,
      refreshing: false,
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
  assert.match(markup, />Abierta</);
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
  assert.match(markup, /role="tab" aria-selected="true"[^>]*>\s*Abiertas/);
});

// --- manual refresh (FASE 7D.1-B) ----------------------------------------------

test('SupportRequestList: the "Actualizar" button is visible regardless of loading/error/empty/populated state', () => {
  for (const props of [{ items: null }, { items: [], error: 'No pudimos cargar las consultas.' }, { items: [] }, { items: [supportRequest()] }]) {
    assert.match(renderList(props), />Actualizar</, `expected "Actualizar" for state ${JSON.stringify(props)}`);
  }
});

test('SupportRequestList: reads "Actualizar" normally, and "Actualizando..." disabled while refreshing', () => {
  const normal = renderList({ refreshing: false });
  assert.match(normal, />Actualizar</);
  assert.doesNotMatch(normal, /disabled=""[^>]*>[^<]*<svg[^>]*>[\s\S]*?Actualizar</);
  const refreshingMarkup = renderList({ refreshing: true });
  assert.match(refreshingMarkup, /disabled=""[^>]*>[^<]*<svg[^>]*>[\s\S]*?Actualizando\.\.\./);
});

test('CONTRACT: the "Actualizar" button is wired to onRefresh and disabled exactly while refreshing', () => {
  const source = readFileSync(join(process.cwd(), 'src/admin/components/SupportRequestList.tsx'), 'utf8');
  assert.match(source, /onClick=\{onRefresh\}\s+disabled=\{refreshing\}/);
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

test('SupportRequestDetail: has a "Volver a consultas" back action for the mobile single-pane view', () => {
  const markup = renderDetail({ supportRequest: supportRequest() });
  assert.match(markup, /Volver a consultas/);
});

test('SupportRequestDetail: the Teléfono row is always shown (FASE 7D.1-B) -- the real value when present, "No informado" otherwise, never hidden entirely', () => {
  const withPhone = renderDetail({ supportRequest: supportRequest({ customerPhone: '+54 9 11 1234-5678' }) });
  assert.match(withPhone, /Teléfono:<\/dt>\s*<dd[^>]*>\+54 9 11 1234-5678<\/dd>/);
  const withoutPhone = renderDetail({ supportRequest: supportRequest() });
  assert.match(withoutPhone, /Teléfono:<\/dt>\s*<dd[^>]*>No informado<\/dd>/);
});

// --- WhatsApp contact (FASE 7D-B) ---------------------------------------------

test('SupportRequestDetail: WhatsApp contact button appears when the ticket has a valid phone', () => {
  const markup = renderDetail({ supportRequest: supportRequest({ customerPhone: '+54 9 381 555 1234' }) });
  assert.match(markup, />Contactar por WhatsApp</);
});

test('SupportRequestDetail: no WhatsApp contact button when the ticket has no phone at all', () => {
  const markup = renderDetail({ supportRequest: supportRequest() });
  assert.doesNotMatch(markup, /Contactar por WhatsApp/);
  assert.doesNotMatch(markup, /No se pudo abrir WhatsApp/);
});

test('SupportRequestDetail: an unnormalizable phone shows a discreet notice, never a WhatsApp button or a wa.me link', () => {
  const markup = renderDetail({ supportRequest: supportRequest({ customerPhone: '381 5551234' }) });
  assert.match(markup, /No se pudo abrir WhatsApp con este número\./);
  assert.doesNotMatch(markup, /Contactar por WhatsApp/);
  assert.doesNotMatch(markup, /wa\.me/i);
});

test('SupportRequestDetail: passes key={supportRequest.id} to WhatsAppContactButton, so switching tickets remounts it and never keeps a previous draft', () => {
  const source = readFileSync(join(process.cwd(), 'src/admin/components/SupportRequestDetail.tsx'), 'utf8');
  assert.match(source, /<WhatsAppContactButton\s+key=\{supportRequest\.id\}/);
});

test('SupportRequestDetail: an open ticket offers "responder"/"resolver" but never "reabrir"', () => {
  const markup = renderDetail({ supportRequest: supportRequest({ status: 'open' }) });
  assert.match(markup, />Marcar respondida</);
  assert.match(markup, />Marcar resuelta</);
  assert.doesNotMatch(markup, />Reabrir</);
});

test('SupportRequestDetail: a resolved ticket offers only "reabrir"', () => {
  const markup = renderDetail({ supportRequest: supportRequest({ status: 'resolved' }) });
  assert.match(markup, />Reabrir</);
  assert.doesNotMatch(markup, />Marcar respondida</);
  assert.doesNotMatch(markup, />Marcar resuelta</);
});

test('SupportRequestDetail: an answered ticket offers "reabrir" and "resolver" but not "responder" again', () => {
  const markup = renderDetail({ supportRequest: supportRequest({ status: 'answered' }) });
  assert.match(markup, />Reabrir</);
  assert.match(markup, />Marcar resuelta</);
  assert.doesNotMatch(markup, />Marcar respondida</);
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
  assert.match(markup, />Teléfono</);
  assert.match(markup, />Pedido relacionado</);
  assert.match(markup, />Asunto</);
  assert.doesNotMatch(markup, />Asunto \*</);
  assert.match(markup, />Mensaje \*</);
  assert.match(markup, /maxLength="160"/); // customerName
  assert.match(markup, /maxLength="254"/); // customerEmail
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

test('Soporte: WhatsApp contact (FASE 7D-B) appears only in SupportRequestDetail, never in the list or the create form', () => {
  const listAndForm = renderSupport() + renderCreateForm();
  assert.doesNotMatch(listAndForm, /whatsapp/i);
  assert.doesNotMatch(listAndForm, /wa\.me/i);

  const withPhone = renderDetail({ supportRequest: supportRequest({ customerPhone: '+54 9 11 1234-5678' }) });
  assert.match(withPhone, />Contactar por WhatsApp</);
});

test('Soporte: SupportRequestList itself still never renders WhatsApp, even when items have a phone', () => {
  const markup = renderList({ items: [supportRequest({ customerPhone: '+54 9 11 1234-5678' })] });
  assert.doesNotMatch(markup, /whatsapp/i);
});

// --- list refresh (FASE 7D.1-B) -------------------------------------------------
//
// AdminSupportPage's refresh logic (window focus listener, background
// reload, stale-response guard) lives inside useEffect/async closures that
// renderToStaticMarkup never executes (SSR has no effect phase, confirmed
// by the file-level comment above). These are verified as source-level
// contracts instead -- the same substitute this suite already uses for
// other effect-driven behavior (e.g. the WhatsAppContactButton key= test).

test('CONTRACT: AdminSupportPage registers a window focus listener that triggers a background refresh of the current filter, and cleans it up', () => {
  const source = readFileSync(join(process.cwd(), 'src/admin/pages/AdminSupportPage.tsx'), 'utf8');
  assert.match(source, /window\.addEventListener\('focus', handleFocus\)/);
  assert.match(source, /window\.removeEventListener\('focus', handleFocus\)/);
  assert.match(source, /handleFocus = \(\) => \{\s*void loadList\(filter, \{ background: true \}\);/);
});

test('CONTRACT: the manual "Actualizar" button also triggers a background refresh of the current filter', () => {
  const source = readFileSync(join(process.cwd(), 'src/admin/pages/AdminSupportPage.tsx'), 'utf8');
  assert.match(source, /const handleRefresh = \(\) => void loadList\(filter, \{ background: true \}\);/);
});

test('CONTRACT: a background refresh (manual or focus) never clears the visible list -- only a foreground (filter-change) load does', () => {
  const source = readFileSync(join(process.cwd(), 'src/admin/pages/AdminSupportPage.tsx'), 'utf8');
  assert.match(source, /if \(options\.background\) \{\s*setRefreshing\(true\);\s*\} else \{\s*setItems\(null\);\s*setListError\(null\);\s*\}/);
});

test('CONTRACT: loadList never touches detail, selection or the notes draft -- a background refresh cannot disturb an open ticket', () => {
  const source = readFileSync(join(process.cwd(), 'src/admin/pages/AdminSupportPage.tsx'), 'utf8');
  const loadListBody = /const loadList = async[\s\S]*?\n  \};/.exec(source)?.[0] ?? '';
  assert.ok(loadListBody.length > 0, 'expected to find the loadList function body in the source');
  for (const forbidden of ['setDetail', 'setSelectedId', 'setNotesDraft', 'setOrderContext', 'getSupportRequest']) {
    assert.doesNotMatch(loadListBody, new RegExp(forbidden), `loadList must never reference ${forbidden}`);
  }
});

test('CONTRACT: loadList guards every call with a request-sequence ref, discarding any response superseded by a newer call (filter change, manual refresh or focus racing each other)', () => {
  const source = readFileSync(join(process.cwd(), 'src/admin/pages/AdminSupportPage.tsx'), 'utf8');
  assert.match(source, /const requestSeqRef = useRef\(0\);/);
  assert.match(source, /const seq = \+\+requestSeqRef\.current;/);
  // Applied after the await, both on the success path and the error path.
  assert.match(source, /if \(seq !== requestSeqRef\.current\) return;[\s\S]{0,600}setItems\(nextFilter === 'all'/);
  assert.match(source, /if \(seq !== requestSeqRef\.current\) return;\s*\n\s*if \(!options\.background\) setItems\(\[\]\);/);
});

test('CONTRACT: loadList replaces the entire items array with the fresh server response on every call (FASE 7D.2: "all" additionally excludes archived), so a refresh can never duplicate rows', () => {
  const source = readFileSync(join(process.cwd(), 'src/admin/pages/AdminSupportPage.tsx'), 'utf8');
  assert.match(source, /setItems\(nextFilter === 'all' \? result\.filter\(\(item\) => item\.status !== 'archived'\) : result\);/);
});

test('a web-origin ticket (source=web, created_by NULL) renders in the detail pane without crashing, same as an admin-created one', () => {
  const webTicket = supportRequest({ source: 'web', topic: 'general', createdAt: new Date().toISOString() });
  const markup = renderDetail({ supportRequest: webTicket });
  assert.match(markup, /Web/);
  assert.match(markup, /Consulta general/);
});

test('a web-origin ticket with status=open appears under the "Todas" and "Abiertas" filters in the list, never under "Respondidas"/"Resueltas"', () => {
  const webTicket = supportRequest({ source: 'web', status: 'open' });
  const markup = renderList({ items: [webTicket], filter: 'all' });
  assert.match(markup, /Cliente Real/);
  // SupportRequestList itself never filters client-side -- whatever items
  // the caller passes in (already filtered server-side by listSupportRequests)
  // is what renders; this just confirms an 'open' ticket is never hidden.
});

// --- archive (FASE 7D.2) ---------------------------------------------------------

test('SupportRequestDetail: an active ticket (open/answered/resolved) offers "Archivar"', () => {
  for (const status of ['open', 'answered', 'resolved'] as const) {
    const markup = renderDetail({ supportRequest: supportRequest({ status }) });
    assert.match(markup, />Archivar</, `expected "Archivar" for status=${status}`);
  }
});

test('SupportRequestDetail: an archived ticket offers only "Reabrir", never Archivar/responder/resolver', () => {
  const markup = renderDetail({ supportRequest: supportRequest({ status: 'archived' }) });
  assert.match(markup, />Reabrir</);
  assert.doesNotMatch(markup, />Archivar</);
  assert.doesNotMatch(markup, />Marcar respondida</);
  assert.doesNotMatch(markup, />Marcar resuelta</);
});

test('SupportRequestDetail: an archived ticket still shows its status badge as "Archivada", and its message/phone/notes are still rendered (never deleted)', () => {
  const markup = renderDetail({
    supportRequest: supportRequest({ status: 'archived', customerPhone: '+54 9 381 555 1234', message: 'Mensaje historico conservado.' }),
    notesDraft: 'Nota historica conservada.',
  });
  assert.match(markup, />Archivada</);
  assert.match(markup, /\+54 9 381 555 1234/);
  assert.match(markup, /Mensaje historico conservado\./);
  assert.match(markup, /Nota historica conservada\./);
});

test('SupportRequestList: shows the "Archivadas" tab and an archived ticket renders normally within it (SupportRequestList itself never filters)', () => {
  const markup = renderList({ items: [supportRequest({ status: 'archived' })], filter: 'archived' });
  assert.match(markup, /role="tab" aria-selected="true"[^>]*>\s*Archivadas/);
  assert.match(markup, />Cliente Real</);
  assert.match(markup, />Archivada</);
});

test('CONTRACT: loadList excludes archived tickets only for the "all" filter -- "Archivadas" and every other specific filter pass through untouched', () => {
  const source = readFileSync(join(process.cwd(), 'src/admin/pages/AdminSupportPage.tsx'), 'utf8');
  assert.match(source, /setItems\(nextFilter === 'all' \? result\.filter\(\(item\) => item\.status !== 'archived'\) : result\);/);
});

test('CONTRACT: archiving (or reopening) a ticket removes it from the currently visible list when it no longer matches the active filter, instead of leaving it displayed under the wrong tab', () => {
  const source = readFileSync(join(process.cwd(), 'src/admin/pages/AdminSupportPage.tsx'), 'utf8');
  assert.match(source, /function matchesFilter\(filter: SupportStatusFilter, status: SupportRequestStatus\): boolean \{/);
  assert.match(source, /if \(!matchesFilter\(filter, updated\.status\)\) return current\.filter\(\(item\) => item\.id !== updated\.id\);/);
});

// --- Gmail contact (FASE 7D.2) ---------------------------------------------------

test('SupportRequestDetail: shows "Contactar por Gmail" next to "Contactar por WhatsApp" for a ticket with a real email and phone', () => {
  const markup = renderDetail({ supportRequest: supportRequest({ customerPhone: '+54 9 381 555 1234', customerEmail: 'ana@example.test' }) });
  assert.match(markup, />Contactar por WhatsApp</);
  assert.match(markup, />Contactar por Gmail</);
});

test('SupportRequestDetail: "Contactar por Gmail" still appears even when the ticket has no phone (Gmail only depends on email)', () => {
  const markup = renderDetail({ supportRequest: supportRequest({ customerPhone: undefined, customerEmail: 'ana@example.test' }) });
  assert.doesNotMatch(markup, /Contactar por WhatsApp/);
  assert.match(markup, />Contactar por Gmail</);
});
