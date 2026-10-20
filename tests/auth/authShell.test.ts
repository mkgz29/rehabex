import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';

import { AuthContext } from '../../src/auth/AuthProvider.tsx';
import { LoginPage } from '../../src/pages/LoginPage.tsx';
import { RegisterPage } from '../../src/pages/RegisterPage.tsx';

(globalThis as typeof globalThis & { React: typeof React }).React = React;

const anonymousAuth = {
  user: null, session: null, profile: null, isAdmin: false, loading: false,
  signIn: async () => undefined, signUp: async () => undefined, signOut: async () => undefined,
};

function render(page: React.FunctionComponent) {
  return renderToStaticMarkup(
    React.createElement(MemoryRouter, null, React.createElement(AuthContext.Provider, { value: anonymousAuth }, React.createElement(page))),
  );
}

const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');

test('Login redesign: visible labels bound to their inputs, brand logo and a single H1', () => {
  const markup = render(LoginPage);
  assert.match(markup, /<label[^>]*for="login-email"[^>]*>Email<\/label>/);
  assert.match(markup, /<label[^>]*for="login-password"[^>]*>Contraseña<\/label>/);
  assert.match(markup, /id="login-email"/);
  assert.match(markup, /id="login-password"/);
  assert.equal((markup.match(/<h1/g) ?? []).length, 1);
  assert.match(markup, /rehabex-logo-light\.svg/);
  assert.match(markup, />Ingresar<\/button>/);
});

test('Login redesign: show/hide password is a labelled toggle button and the field stays a password field by default', () => {
  const markup = render(LoginPage);
  assert.match(markup, /<button type="button"[^>]*aria-label="Mostrar contraseña"[^>]*aria-pressed="false"/);
  assert.match(markup, /type="password"/);
});

test('Login redesign: no social login, remember-me or recovery that the auth flow does not implement', () => {
  const markup = render(LoginPage);
  assert.doesNotMatch(markup, /Google|Apple|Facebook|oauth|Recordarme|Mantener sesi|Olvid|Recuperar/i);
  const source = read('src/pages/LoginPage.tsx');
  assert.doesNotMatch(source, /signInWithOAuth|resetPasswordForEmail/);
});

test('Login redesign: the auth logic is unchanged (normalization, generic error, redirect target)', () => {
  const source = read('src/pages/LoginPage.tsx');
  assert.match(source, /normalizeEmail\(email\)/);
  assert.match(source, /isValidEmailFormat\(normalizedEmail\)/);
  assert.match(source, /await signIn\(normalizedEmail, password\)/);
  assert.match(source, /\?\.from\?\.pathname \?\? '\/admin'/);
  assert.match(source, /disabled=\{submitting \|\| loading\}/);
  assert.match(source, /role="alert"/);
  assert.match(source, /aria-describedby=\{error \? 'login-error' : undefined\}/);
});

test('Auth fields: icons are decorative, the toggle meets a 40px target and focus uses the Rehabex accent', () => {
  const source = read('src/components/auth/AuthFields.tsx');
  assert.match(source, /aria-hidden="true"/);
  assert.match(source, /h-10 w-10/);
  assert.match(source, /focus-visible:border-brand/);
  assert.match(source, /aria-\[invalid=true\]:border-red-400/);
  assert.match(source, /Mostrar contraseña/);
  assert.match(source, /Ocultar contraseña/);
});

test('Auth shell: media above the form on mobile, two columns from md, reduced motion respected through the shared entrance', () => {
  const source = read('src/components/auth/AuthShell.tsx');
  assert.match(source, /md:grid md:grid-cols-/);
  assert.match(source, /auth-media/);
  assert.match(source, /hero-enter/); // neutralised globally under prefers-reduced-motion
  assert.doesNotMatch(source, /animate-|infinite|blur-|glow/);
  // The login photograph is the bundled Rehabex asset: decorative, no CMS fetch, no external URL.
  assert.match(source, /assets\/auth\/rehabex-login-athlete\.png/);
  assert.match(source, /<img[\s\S]*alt=""[\s\S]*object-cover/);
  assert.doesNotMatch(source, /getLandingContent|FramedImage|https?:\/\//);
  assert.match(source, /h-\[19rem\]/); // ~304px hero on mobile
  assert.ok(readFileSync(join(process.cwd(), 'src/assets/auth/rehabex-login-athlete.png')).length > 0);
});

test('Register page: same shell and fields, logic untouched, still not routed', () => {
  const markup = render(RegisterPage);
  assert.match(markup, /for="register-email"/);
  assert.match(markup, /autoComplete="new-password"/);
  const source = read('src/pages/RegisterPage.tsx');
  assert.match(source, /await signUp\(email\.trim\(\), password\)/);
  assert.doesNotMatch(read('src/App.tsx'), /<RegisterPage/);
});

test('AppLayout: sign-in routes render without the site navbar or floating WhatsApp, everything else keeps them', () => {
  const source = read('src/components/AppLayout.tsx');
  assert.match(source, /IMMERSIVE_PATHS = new Set\(\['\/login', '\/registro'\]\)/);
  assert.match(source, /immersive \? null : <Navbar \/>/);
  assert.match(source, /immersive \? null : <FloatingWhatsAppButton \/>/);
});

test('Auth media shape: a soft diagonal clip (bottom on mobile, side from md) defined once and never hiding the copy', () => {
  const source = read('src/components/auth/AuthShell.tsx');
  const css = read('src/index.css').replace(/\r\n/g, '\n');
  assert.match(read('src/components/media/DiagonalShapeDefs.tsx'), /id="shape-diagonal-bottom"[\s\S]*id="shape-diagonal-side"[\s\S]*id="shape-diagonal-hero"/);
  assert.match(read('src/components/media/DiagonalShapeDefs.tsx'), /clipPathUnits="objectBoundingBox"/);
  assert.match(css, /\.auth-media \{\s*clip-path: url\(#shape-diagonal-bottom\);/);
  assert.match(css, /@media \(min-width: 768px\) \{\s*\.auth-media \{\s*clip-path: url\(#shape-diagonal-side\);/);
  // The decorative SVG is hidden from assistive tech and the tagline keeps clear of the slanted edge on phones.
  assert.match(read('src/components/media/DiagonalShapeDefs.tsx'), /<svg[^>]*aria-hidden="true"/);
  assert.match(source, /<DiagonalShapeDefs \/>/);
  assert.match(source, /max-w-\[16rem\] md:max-w-sm/);
});

test('Hero media shape: the home hero card shares the diagonal family without touching carousel, images or copy', () => {
  const css = read('src/index.css').replace(/\r\n/g, '\n');
  const hero = read('src/components/HeroSection.tsx');
  assert.match(css, /\.hero-media \{\s*clip-path: url\(#shape-diagonal-hero\);/);
  assert.match(hero, /hero-media /);
  assert.match(hero, /<DiagonalShapeDefs \/>/);
  // Only the container shape changed: the carousel still gets the same props and the badge copy is intact.
  assert.match(hero, /<HeroCarousel images=\{heroContent\.images\} isLoading=\{isLoading\} onCurrentImageFailed=\{setCurrentImageFailed\} \/>/);
  assert.match(hero, /Selección Rehabex/);
});

test('Hero composition: a balanced panel (~58% of the hero) with a capped height, not a full-screen block', () => {
  const hero = read('src/components/HeroSection.tsx');
  const css = read('src/index.css').replace(/\r\n/g, '\n');
  assert.match(hero, /lg:grid-cols-\[minmax\(0,46fr\)_minmax\(0,54fr\)\]/); // copy ~43% / panel ~57% at 1024
  assert.match(hero, /min-\[1200px\]:grid-cols-\[minmax\(0,45fr\)_minmax\(0,55fr\)\]/); // copy ~42% / panel ~58% from 1200
  assert.match(hero, /lg:max-w-none/); // no longer boxed by .site-container
  // The panel reaches into the hero (negative margin + wider box); height stays ~540px at 1440.
  assert.match(hero, /lg:h-\[clamp\(24rem,38cqw,33\.75rem\)\] lg:w-\[calc\(100%\+3cqw\)\] lg:ml-\[calc\(-3cqw\)\]/); // only a slight reach into the copy column
  // Compact vertical rhythm: only a small margin above and below the panel (16px), no dead bands.
  assert.match(hero, /lg:py-4 lg:pr-0 lg:pl-0/);
  // The panel nudges 12px up and 20px down, so its lowest point meets the next section (size and diagonal unchanged).
  assert.match(hero, /lg:-mt-3 lg:-mb-5 lg:self-end/); // anchored to the benefits strip even when long copy makes the hero taller
  assert.doesNotMatch(hero, /lg:py-12/);
  // Its LEFT edge is the diagonal (starts ~28% in at the top, opens to the box edge at the bottom).
  assert.match(read('src/components/media/DiagonalShapeDefs.tsx'), /id="shape-diagonal-hero-wide"[\s\S]*M0\.285,0 H1 V0\.972 L0\.05,0\.99 Q0,0\.995 0,0\.962 L0\.25,0\.03/);
  assert.match(hero, /md:min-h-0/); // the hero no longer fills the whole viewport from tablet up
  assert.doesNotMatch(hero, /lg:min-h-\[min\(calc\(100svh/);
  assert.match(hero, /hero-media /);
  assert.match(css, /\.hero-media \{\s*clip-path: url\(#shape-diagonal-hero-wide\);/);
  assert.match(hero, /md:grid-cols-\[minmax\(0,0\.85fr\)_minmax\(0,1\.15fr\)\]/);
  assert.match(hero, /aspect-\[7\/8\][^"]*max-md:-mx-\[var\(--space-page\)\][^"]*sm:aspect-\[4\/3\]/);
  assert.match(css, /\.hero-copy \{\s*padding-left: var\(--space-page\);\s*padding-left: max\(var\(--space-page\), calc\(\(100cqw - 84rem\) \/ 2 \+ var\(--space-page\)\)\);/);
  assert.doesNotMatch(hero, /h-\[\d+px\]|min-h-\[\d+px\]/);
});

test('Hero layers: a real photograph only gets a thin bottom scrim; gradient and glow belong to the placeholder state', () => {
  const hero = read('src/components/HeroSection.tsx');
  const carousel = read('src/components/HeroCarousel.tsx');
  assert.match(hero, /const showsPhoto = !isLoading && heroContent\.images\.length > 0 && !currentImageFailed;/);
  const photoBranch = hero.slice(hero.indexOf('showsPhoto ? ('), hero.indexOf('Placeholder look'));
  assert.match(photoBranch, /transparent_22%/); // scrim limited to the bottom ~22%
  assert.doesNotMatch(photoBranch, /radial-gradient|from-dark\/25|brand/);
  const placeholderBranch = hero.slice(hero.indexOf('Placeholder look'), hero.indexOf('Selección Rehabex'));
  assert.match(placeholderBranch, /from-dark\/25/);
  assert.match(placeholderBranch, /radial-gradient/);
  // A failing image switches to the neutral fallback instead of a broken <img> over the placeholder look.
  assert.match(carousel, /onError=\{\(\) => setFailedUrls/);
  assert.match(carousel, /Imagen no disponible/);
  assert.match(carousel, /Imagen no configurada/);
  assert.match(carousel, /onCurrentImageFailed\?\.\(currentFailed\)/);
  // The CMS data path is untouched: same props to FramedImage, same framing fallback.
  assert.match(carousel, /framing: image\.framing \?\? DEFAULT_FRAMING/);
});
