import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Archive } from 'lucide-react';

import { AdminIconButton } from '../../src/admin/components/AdminIconButton';

(globalThis as typeof globalThis & { React: typeof React }).React = React;

// FASE 7D.4: icons/density polish for the repeated Admin action buttons
// (WhatsApp, Gmail, Archivar, Reabrir, Actualizar, Editar). This project's
// test suite has no DOM/event simulation (see adminSupportInbox.test.ts's
// header comment), so "still calls the same action" is verified as a
// source-level onClick-wiring contract, same substitute already used
// elsewhere in this suite, rather than a simulated click.

function render(node: React.ReactElement) {
  return renderToStaticMarkup(node);
}

// --- AdminIconButton itself ---------------------------------------------------

test('AdminIconButton: icon-only has no visible text, but carries aria-label and a title tooltip', () => {
  const markup = render(React.createElement(AdminIconButton, { icon: Archive, label: 'Archivar' }));
  assert.match(markup, /aria-label="Archivar"/);
  assert.match(markup, /title="Archivar"/);
  assert.match(markup, /<span class="sr-only">Archivar<\/span>/);
});

test('AdminIconButton: icon-only uses accessibleLabel for aria-label when given, title/sr-only text stays the short label', () => {
  const markup = render(React.createElement(AdminIconButton, { icon: Archive, label: 'Archivar', accessibleLabel: 'Archivar consulta' }));
  assert.match(markup, /aria-label="Archivar consulta"/);
  assert.match(markup, /title="Archivar"/);
});

test('AdminIconButton: icon+text (showLabel) shows the label visibly and drops the redundant aria-label', () => {
  const markup = render(React.createElement(AdminIconButton, { icon: Archive, label: 'Archivar', showLabel: true }));
  assert.doesNotMatch(markup, /aria-label=/);
  assert.match(markup, /title="Archivar"/);
  assert.match(markup, /<span>Archivar<\/span>/);
});

test('AdminIconButton: the icon itself is aria-hidden, never announced on its own', () => {
  const markup = render(React.createElement(AdminIconButton, { icon: Archive, label: 'Archivar' }));
  assert.match(markup, /<svg[^>]*aria-hidden="true"/);
});

test('AdminIconButton: icon-only keeps the existing 44px (min-h-11/min-w-11) touch target', () => {
  const markup = render(React.createElement(AdminIconButton, { icon: Archive, label: 'Archivar' }));
  assert.match(markup, /min-h-11/);
  assert.match(markup, /min-w-11/);
});

test('AdminIconButton: tone classes are additive, never the only signal (icon + label always present too)', () => {
  const archive = render(React.createElement(AdminIconButton, { icon: Archive, label: 'Archivar', tone: 'archive' }));
  assert.match(archive, /bg-amber-50/);
  assert.doesNotMatch(archive, /bg-red-50|border-red-300/); // archive must never use the destructive/danger tone
});

test('AdminIconButton: renders as a real <a> when href is given, with the same accessible-name treatment', () => {
  const markup = render(React.createElement(AdminIconButton, { icon: Archive, label: 'Abrir', href: 'https://example.test' }));
  assert.match(markup, /<a href="https:\/\/example\.test"[^>]*aria-label="Abrir"/);
});

// --- Soporte: Archivar/Reabrir keep calling the exact same onChangeStatus ----

test('CONTRACT: Archivar/Reabrir render as AdminIconButton but still call onChangeStatus(next), same as every other status action', () => {
  const source = readFileSync(join(process.cwd(), 'src/admin/components/SupportRequestDetail.tsx'), 'utf8');
  assert.match(source, /onClick=\{\(\) => onChangeStatus\(next\)\}/);
  assert.match(source, /icon=\{iconConfig\.icon\}/);
});

test('CONTRACT: Archivar uses the amber "archive" tone, Reabrir uses "reopen" -- neither uses the destructive/danger tone', () => {
  const source = readFileSync(join(process.cwd(), 'src/admin/components/SupportRequestDetail.tsx'), 'utf8');
  assert.match(source, /archived:\s*\{\s*icon:\s*Archive,\s*tone:\s*'archive'\s*\}/);
  assert.match(source, /open:\s*\{\s*icon:\s*RotateCcw,\s*tone:\s*'reopen'\s*\}/);
});

// --- Soporte/Pedidos: WhatsApp and Gmail stay icon-only and consistent -------

test('CONTRACT: WhatsAppContactButton (shared by Soporte and Pedidos) toggles via AdminIconButton, same component for both', () => {
  const source = readFileSync(join(process.cwd(), 'src/admin/components/WhatsAppContactButton.tsx'), 'utf8');
  assert.match(source, /<AdminIconButton icon=\{MessageCircle\} label="Contactar por WhatsApp" tone="whatsapp"/);
});

test('CONTRACT: GmailContactLink renders via AdminIconButton with an envelope icon, not Gmail branding/colors', () => {
  const source = readFileSync(join(process.cwd(), 'src/admin/components/GmailContactLink.tsx'), 'utf8');
  assert.match(source, /icon=\{Mail\}/);
  assert.doesNotMatch(source, /#ea4335|#4285f4|gmail-red|gmail-blue/i);
});

// --- Soporte: Actualizar keeps refreshing the same list -----------------------

test('CONTRACT: Actualizar is icon-only (RefreshCw) but still wired to onRefresh, disabled exactly while refreshing', () => {
  const source = readFileSync(join(process.cwd(), 'src/admin/components/SupportRequestList.tsx'), 'utf8');
  assert.match(source, /icon=\{RefreshCw\}/);
  assert.match(source, /onClick=\{onRefresh\}\s+disabled=\{refreshing\}/);
  assert.match(source, /aria-busy=\{refreshing\}/);
});

// --- Productos: Editar/Mostrar-Ocultar keep calling the same handlers -------

test('CONTRACT: the product row\'s "Editar" icon button still calls openEditForm(product)', () => {
  const source = readFileSync(join(process.cwd(), 'src/admin/pages/AdminProductsPage.tsx'), 'utf8');
  assert.match(source, /icon=\{Pencil\} label="Editar producto" size="sm" onClick=\{\(\) => openEditForm\(product\)\}/);
});

test('CONTRACT: the product row\'s visibility toggle still calls the same handlers (setPendingHideId / handleSetActive), only its icon/label changes with state', () => {
  const source = readFileSync(join(process.cwd(), 'src/admin/pages/AdminProductsPage.tsx'), 'utf8');
  assert.match(source, /icon=\{product\.active \? EyeOff : Eye\}/);
  assert.match(source, /onClick=\{\(\) => \(product\.active \? setPendingHideId\(product\.id\) : handleSetActive\(product, true\)\)\}/);
});

test('CONTRACT: the visibility toggle keeps icon+text (showLabel) -- the label still carries the real state, unlike a single ambiguous icon', () => {
  const source = readFileSync(join(process.cwd(), 'src/admin/pages/AdminProductsPage.tsx'), 'utf8');
  assert.match(source, /label=\{togglingId === product\.id \? 'Actualizando\.\.\.' : product\.active \? 'Ocultar de la tienda' : 'Mostrar en la tienda'\}\s*\n\s*showLabel/);
});
