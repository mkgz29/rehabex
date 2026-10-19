import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';

import { WithdrawalRequestPage, WithdrawalRequestView } from '../../src/pages/WithdrawalRequestPage.tsx';
import { mapAdminSupportRequestRow } from '../../server/admin/serialize.ts';

(globalThis as typeof globalThis & { React: typeof React }).React = React;

test('the public page renders without auth and asks only for minimal identification', () => {
  const markup = renderToStaticMarkup(React.createElement(MemoryRouter, null, React.createElement(WithdrawalRequestPage)));
  assert.match(markup, /BOTÓN DE ARREPENTIMIENTO/);
  assert.match(markup, /Nombre y apellido/);
  assert.match(markup, /Email usado en la compra/);
  assert.match(markup, /Número de pedido/);
  assert.doesNotMatch(markup, /type="password"|name="password"|href="\/login"/i);

  const source = readFileSync(join(process.cwd(), 'src/pages/WithdrawalRequestPage.tsx'), 'utf8');
  assert.doesNotMatch(source, /ProtectedRoute|adminApi|supabase/i);
});

test('the route is public and the exact prominent access is present on first access and in the footer', () => {
  const app = readFileSync(join(process.cwd(), 'src/App.tsx'), 'utf8');
  const bar = readFileSync(join(process.cwd(), 'src/components/AnnouncementBar.tsx'), 'utf8');
  const footer = readFileSync(join(process.cwd(), 'src/components/SiteFooter.tsx'), 'utf8');
  assert.match(app, /path="\/arrepentimiento" element=\{<WithdrawalRequestPage \/>\}/);
  assert.ok(app.indexOf('path="/arrepentimiento"') < app.indexOf('path="/admin"'));
  assert.match(bar, /to="\/arrepentimiento"[\s\S]*BOTÓN DE ARREPENTIMIENTO/);
  assert.match(footer, /to="\/arrepentimiento"[\s\S]*BOTÓN DE ARREPENTIMIENTO/);
});

test('success communicates the generated code and removes the form', () => {
  const markup = renderToStaticMarkup(React.createElement(MemoryRouter, null, React.createElement(WithdrawalRequestView, {
    status: 'success', requestCode: 'ARR-20261019-A1B2C3D4', errorMessage: null,
    values: { customerName: '', customerEmail: '', customerPhone: '', orderReference: '', message: '' },
    honeypotValue: '', onFieldChange: () => undefined, onHoneypotChange: () => undefined, onSubmit: () => undefined,
  })));
  assert.match(markup, /ARR-20261019-A1B2C3D4/);
  assert.match(markup, /Guardá tu código de trámite/);
  assert.doesNotMatch(markup, /<form/);
});

test('the protected admin response exposes the case kind, code and deadline for later management', () => {
  const mapped = mapAdminSupportRequestRow({
    id: '11111111-1111-4111-8111-111111111111', customer_name: 'Cliente', customer_email: 'cliente@example.test',
    customer_phone: null, subject: 'Solicitud de arrepentimiento', message: 'Sin comentarios adicionales.', status: 'open',
    order_id: null, order_reference: 'RHB-123', source: 'web', topic: 'returns_warranty', internal_notes: null,
    created_by: null, created_at: '2026-10-19T12:00:00Z', updated_at: '2026-10-19T12:00:00Z',
    request_kind: 'withdrawal', request_code: 'ARR-20261019-A1B2C3D4', response_due_at: '2026-10-20T12:00:00Z',
  });
  assert.equal(mapped.requestKind, 'withdrawal');
  assert.equal(mapped.requestCode, 'ARR-20261019-A1B2C3D4');
  assert.equal(mapped.responseDueAt, '2026-10-20T12:00:00Z');
});

test('migration is additive, service-role only, sets a 24-hour deadline and does not touch commerce or RLS', () => {
  const sql = readFileSync(join(process.cwd(), 'supabase/migrations/202610210101_withdrawal_requests.sql'), 'utf8');
  const executableSql = sql.replace(/--.*$/gm, '');
  assert.match(sql, /request_kind text NOT NULL DEFAULT 'support'/);
  assert.match(sql, /now\(\) \+ interval '24 hours'/);
  assert.match(sql, /GRANT EXECUTE[\s\S]*TO service_role/);
  assert.match(sql, /REVOKE ALL[\s\S]*FROM PUBLIC, anon, authenticated/);
  assert.doesNotMatch(executableSql, /UPDATE\s+public\.orders|DELETE\s+FROM|mercado|refund|ENABLE ROW LEVEL SECURITY|CREATE POLICY/i);
});
