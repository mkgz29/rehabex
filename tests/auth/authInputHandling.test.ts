import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';

import { EMAIL_MAX_LENGTH, isValidEmailFormat, normalizeEmail } from '../../src/auth/emailNormalization.ts';
import { AuthContext } from '../../src/auth/AuthProvider.tsx';
import { CartProvider } from '../../src/cart/CartProvider.tsx';
import { LoginPage } from '../../src/pages/LoginPage.tsx';
import { MobileNavigation } from '../../src/components/MobileNavigation.tsx';
import { SiteHeader } from '../../src/components/SiteHeader.tsx';

(globalThis as typeof globalThis & { React: typeof React }).React = React;

// Typing into a field and submitting the form needs real event dispatch,
// which this repo's test setup can't do without a DOM (no jsdom here,
// matching every other interaction-heavy flow). normalizeEmail/
// isValidEmailFormat carry all of the actual decision logic and are fully
// testable in isolation; LoginPage's static markup covers everything that
// doesn't require simulating input.

test('normalizeEmail trims and lowercases, never touches the password', () => {
  assert.equal(normalizeEmail('  Owner@Rehabex.TEST  '), 'owner@rehabex.test');
});

test('isValidEmailFormat accepts a plausible address and rejects malformed ones', () => {
  assert.equal(isValidEmailFormat('owner@rehabex.test'), true);
  assert.equal(isValidEmailFormat(''), false);
  assert.equal(isValidEmailFormat('not-an-email'), false);
  assert.equal(isValidEmailFormat('missing-domain@'), false);
  assert.equal(isValidEmailFormat('a'.repeat(EMAIL_MAX_LENGTH) + '@x.com'), false);
});

const anonymousAuth = {
  user: null,
  session: null,
  profile: null,
  isAdmin: false,
  loading: false,
  signIn: async () => undefined,
  signUp: async () => undefined,
  signOut: async () => undefined,
};

function renderLoginPage() {
  return renderToStaticMarkup(
    React.createElement(
      MemoryRouter,
      { initialEntries: ['/login'] },
      React.createElement(AuthContext.Provider, { value: anonymousAuth }, React.createElement(LoginPage)),
    ),
  );
}

test('Login: email and password share the hardened input, with the attributes a password manager and screen reader need', () => {
  const markup = renderLoginPage();
  assert.match(markup, /type="email"[^>]*class="admin-input/);
  assert.match(markup, /autoComplete="email"/);
  assert.match(markup, /maxLength="254"/);
  assert.match(markup, /type="password"[^>]*class="admin-input/);
  assert.match(markup, /autoComplete="current-password"/);
});

test('Login: with no submit yet, neither field is marked invalid and no error is shown', () => {
  const markup = renderLoginPage();
  assert.doesNotMatch(markup, /aria-invalid="true"/);
  assert.doesNotMatch(markup, /role="alert"/);
});

test('Registro: /registro redirects to /login instead of serving RegisterPage, and is not wired into App.tsx', () => {
  // <Navigate> performs the redirect through a router-internal effect that
  // renderToStaticMarkup cannot observe, so this reads the route table
  // directly instead -- the same technique vercelRouting.test.ts uses to
  // assert routing shape without a full browser.
  const appSource = readFileSync(join(process.cwd(), 'src/App.tsx'), 'utf8');
  assert.match(appSource, /path="\/registro"[^/]*element=\{<Navigate to="\/login" replace \/>\}/);
  assert.doesNotMatch(appSource, /<RegisterPage|import \{ RegisterPage \}/);
});

const fakeAuthAnonymous = anonymousAuth;

function renderSiteHeader() {
  return renderToStaticMarkup(
    React.createElement(
      MemoryRouter,
      null,
      React.createElement(
        AuthContext.Provider,
        { value: fakeAuthAnonymous },
        React.createElement(CartProvider, null, React.createElement(SiteHeader)),
      ),
    ),
  );
}

test('SiteHeader: no "Crear cuenta" promotion for a logged-out visitor', () => {
  const markup = renderSiteHeader();
  assert.doesNotMatch(markup, /Crear cuenta/);
  assert.match(markup, /Ingresar a mi cuenta/);
});

test('MobileNavigation: no "Crear cuenta" promotion, Ingresar remains the single CTA', () => {
  const markup = renderToStaticMarkup(
    React.createElement(
      MemoryRouter,
      null,
      React.createElement(MobileNavigation, {
        isOpen: true,
        activeHref: '',
        showAdminLink: false,
        showAuthLinks: true,
        showLogout: false,
        onClose: () => undefined,
        onLogout: () => undefined,
        triggerRef: { current: null },
      }),
    ),
  );
  assert.doesNotMatch(markup, /Crear cuenta/);
  assert.doesNotMatch(markup, /\/registro/);
  assert.match(markup, />Ingresar</);
});
