import assert from 'node:assert/strict';
import test from 'node:test';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

import { AuthContext } from '../../src/auth/AuthProvider.tsx';
import { AdminLayout, adminLinks } from '../../src/admin/components/AdminLayout.tsx';
import { AdminEditPagePage } from '../../src/admin/pages/AdminEditPagePage.tsx';
import { AdminHomePage, DashboardContent } from '../../src/admin/pages/AdminHomePage.tsx';
import { AdminOrdersPage } from '../../src/admin/pages/AdminOrdersPage.tsx';
import { LEGACY_ADMIN_REDIRECTS } from '../../src/admin/legacyRedirects.ts';
import { UnsavedChangesProvider } from '../../src/admin/unsavedChanges/UnsavedChangesContext.tsx';

(globalThis as typeof globalThis & { React: typeof React }).React = React;

const fakeAuthValue = {
  user: { id: 'admin-1', email: 'owner@rehabex.test' } as never,
  session: null,
  profile: { id: 'admin-1', role: 'admin' as const },
  isAdmin: true,
  loading: false,
  signIn: async () => undefined,
  signUp: async () => undefined,
  signOut: async () => undefined,
};

function renderLayout() {
  return renderToStaticMarkup(
    React.createElement(
      MemoryRouter,
      { initialEntries: ['/admin'] },
      React.createElement(
        AuthContext.Provider,
        { value: fakeAuthValue },
        React.createElement(
          Routes,
          null,
          React.createElement(
            Route,
            { path: '/admin', element: React.createElement(AdminLayout) },
            React.createElement(Route, { index: true, element: React.createElement('div', null, 'SECTION_PLACEHOLDER') }),
          ),
        ),
      ),
    ),
  );
}

test('the menu contains exactly the five required sections, in order', () => {
  assert.deepEqual(
    adminLinks.map((link) => link.label),
    ['Resumen', 'Editar página', 'Productos', 'Pedidos', 'Soporte'],
  );
});

test('rendered menu has no trace of the retired Inicio/Hero/Ventas/Sobre Nosotros labels', () => {
  const markup = renderLayout();
  assert.doesNotMatch(markup, />Inicio</);
  assert.doesNotMatch(markup, />Hero</);
  assert.doesNotMatch(markup, />Ventas</);
  assert.doesNotMatch(markup, />Sobre Nosotros</);
  assert.match(markup, />Resumen</);
  assert.match(markup, />Editar página</);
  assert.match(markup, />Productos</);
  assert.match(markup, />Pedidos</);
  assert.match(markup, />Soporte</);
  assert.match(markup, />Cerrar sesión</);
});

test('the layout no longer shows the admin email as visible content, and drops the old technical subtext', () => {
  const markup = renderLayout();
  assert.doesNotMatch(markup, /owner@rehabex\.test/);
  assert.doesNotMatch(markup, /Edita la landing/);
  assert.match(markup, /Administrá tu tienda desde un solo lugar\./);
});

test('legacy Hero, Sobre Nosotros and Ordenes routes redirect to the unified destinations, never disappear', () => {
  assert.deepEqual(LEGACY_ADMIN_REDIRECTS, {
    hero: '/admin/pagina',
    'quienes-somos': '/admin/pagina',
    ordenes: '/admin/pedidos',
  });
});

function renderEditPage() {
  return renderToStaticMarkup(
    React.createElement(UnsavedChangesProvider, null, React.createElement(AdminEditPagePage)),
  );
}

test('Editar pagina shows five plain-language summaries and keeps editing fields closed initially', () => {
  const markup = renderEditPage();
  assert.match(markup, /Portada principal/);
  assert.match(markup, /Productos destacados/);
  assert.match(markup, /Acerca de Rehabex/);
  assert.match(markup, /Datos destacados/);
  assert.match(markup, /Catálogo de productos/);
  assert.equal((markup.match(/aria-expanded="false"/g) ?? []).length, 5);
  assert.doesNotMatch(markup, /<form/);
});

test('Editar pagina never leaks internal/technical vocabulary to a non-technical admin', () => {
  const markup = renderEditPage();
  // "Sin Supabase, esta sección no puede guardarse" is a pre-existing, already
  // reviewed environment-diagnostic notice (CMS-UI-01), shown only when
  // Supabase truly is not configured -- not vocabulary this phase introduces.
  const forbidden = [/\bCTA\b/i, /\bslug\b/i, /\basset\b/i, /\bpipeline\b/i, /\bRPC\b/i, /cloudinary/i, /\bUUID\b/i, /object-cover/i];
  for (const pattern of forbidden) {
    assert.doesNotMatch(markup, pattern, `forbidden vocabulary matched: ${pattern}`);
  }
  assert.doesNotMatch(markup, />Hero</);
  assert.doesNotMatch(markup, /Quienes somos/i);
});

function renderWithAuth(element: React.ReactElement) {
  return renderToStaticMarkup(
    React.createElement(
      MemoryRouter,
      null,
      React.createElement(AuthContext.Provider, { value: fakeAuthValue }, element),
    ),
  );
}

test('Resumen: while loading, shows no invented numbers -- only a loading state', () => {
  const markup = renderWithAuth(React.createElement(AdminHomePage));
  assert.match(markup, /aria-busy="true"/);
  assert.doesNotMatch(markup, /Productos visibles/);
  assert.doesNotMatch(markup, /Pedidos que requieren revisión/);
});

test('Resumen never advertises analytics that remain outside phase two', () => {
  const markup = renderWithAuth(React.createElement(AdminHomePage));
  const excluded = [/visitas/i, /conversi[oó]n/i, /carritos? abandonados?/i, /clientes recurrentes/i];
  for (const pattern of excluded) {
    assert.doesNotMatch(markup, pattern, `Resumen unexpectedly references excluded feature: ${pattern}`);
  }
});

test('Resumen KPI and sales chart expose temporal comparisons without technical enums', () => {
  const now = new Date();
  const daysAgo = (days: number) => new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
  // The monthly KPIs (Ventas del mes, Pedidos cobrados, Ticket promedio) compare
  // literal calendar months, so these two stay calendar-relative.
  const currentPaidAt = new Date(now.getFullYear(), now.getMonth(), 1, 10).toISOString();
  const previousPaidAt = new Date(now.getFullYear(), now.getMonth() - 1, 15, 10).toISOString();
  // The sales trend chart instead compares a rolling 30-day window against the
  // 30 days before it. Calendar-month dates don't reliably land on either side
  // of that boundary (it depends on which day of the month the suite runs), so
  // these two extra orders pin the comparison with fixed day offsets: always
  // inside the current window, and always inside the previous one.
  const rollingCurrentPaidAt = daysAgo(10);
  const rollingPreviousPaidAt = daysAgo(40);
  const markup = renderWithAuth(React.createElement(DashboardContent, {
    products: [],
    ordersAvailable: true,
    orders: [
      { payment_status: 'approved', paid_at: currentPaidAt, total_amount: 200 },
      { payment_status: 'approved', paid_at: previousPaidAt, total_amount: 100 },
      { payment_status: 'approved', paid_at: rollingCurrentPaidAt, total_amount: 80 },
      { payment_status: 'approved', paid_at: rollingPreviousPaidAt, total_amount: 40 },
    ],
  }));

  assert.equal((markup.match(/mes anterior/g) ?? []).length, 3);
  assert.match(markup, /30 días anteriores/);
  assert.doesNotMatch(markup, /not_started|preparing|ready_for_pickup|charged_back/);
  assert.doesNotMatch(markup, /NaN|Infinity|-Infinity|>undefined</);
});

test('Pedidos: page title and description no longer say "Ventas"', () => {
  const markup = renderWithAuth(React.createElement(AdminOrdersPage));
  assert.match(markup, />Pedidos</);
  assert.doesNotMatch(markup, />Ventas</);
});
