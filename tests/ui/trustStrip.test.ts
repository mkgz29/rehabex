import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { nearestSlideIndex, MARQUEE_COPIES, nextAutoplayIndex, TrustStrip } from '../../src/components/TrustStrip';

(globalThis as typeof globalThis & { React: typeof React }).React = React;

const source = readFileSync(join(process.cwd(), 'src/components/TrustStrip.tsx'), 'utf8');
const css = readFileSync(join(process.cwd(), 'src/index.css'), 'utf8').replace(/\r\n/g, '\n');

const BENEFITS: Array<[string, string]> = [
  ['Pago seguro', 'Procesado mediante Mercado Pago.'],
  ['Información clara', 'Especificaciones principales de cada producto.'],
  ['Stock visible', 'Disponibilidad actualizada en el catálogo.'],
  ['Selección profesional', 'Equipamiento para rendimiento y recuperación.'],
  ['Compra simple', 'Un proceso directo, claro y sin pasos innecesarios.'],
  ['Atención personalizada', 'Contacto directo con el equipo Rehabex.'],
  ['Equipamiento especializado', 'Soluciones pensadas para uso profesional y deportivo.'],
  ['Envíos coordinados', 'Opciones de entrega informadas durante la compra.'],
];

test('TrustStrip: renders the eight benefits in order, each with its own icon', () => {
  const markup = renderToStaticMarkup(React.createElement(TrustStrip));
  const headings = [...markup.matchAll(/<h2[^>]*>([^<]+)<\/h2>/g)].map((match) => match[1]);
  assert.deepEqual(headings, BENEFITS.map(([title]) => title));
  for (const [, text] of BENEFITS) assert.ok(markup.includes(text), text);
  assert.doesNotMatch(markup, /Pago gestionado|Catálogo enfocado|rehabilitación y movilidad/);
  // Eight real benefits plus the visual-only desktop marquee copies.
  assert.equal((markup.match(/data-reveal-item/g) ?? []).length, 8 + 8 * MARQUEE_COPIES);
  // No icon is repeated across the eight benefits.
  const icons = [...source.matchAll(/\{ icon: (\w+), title:/g)].map((match) => match[1]);
  assert.equal(icons.length, 8);
  assert.equal(new Set(icons).size, 8);
});

test('TrustStrip: static 4 x 2 grid when motion is reduced on desktop, scroll-snap carousel below', () => {
  assert.match(source, /lg:grid lg:grid-cols-4/);
  const reduced = /@media \(min-width: 1024px\) and \(prefers-reduced-motion: reduce\) \{([\s\S]*?)\n\}\n/.exec(css);
  assert.ok(reduced, 'static grid dividers live in the reduced-motion desktop query only');
  assert.match(reduced[1], /nth-child\(4n \+ 1\) \{\s*border-left-width: 0;/);
  assert.match(reduced[1], /nth-child\(n \+ 5\):not\(\.trust-copy\) \{\s*border-top: 1px solid/);
  // No Tailwind nth-child utilities on the cards: they would also strip dividers inside the marquee.
  assert.doesNotMatch(source, /\[&:nth-child/);
  assert.match(source, /snap-x snap-mandatory overflow-x-auto/);
  assert.match(source, /snap-start/);
  assert.match(source, /basis-\[78%\]/); // the next card peeks in
  assert.match(source, /overscroll-x-contain/);
  assert.doesNotMatch(source, /ChevronLeft|ChevronRight|aria-label="(Anterior|Siguiente)/);
});

test('TrustStrip: autoplay is slow, honours reduced motion and pauses after manual interaction', () => {
  assert.match(source, /usePrefersReducedMotion/);
  assert.match(source, /isCarousel \|\| prefersReducedMotion|!isCarousel \|\| prefersReducedMotion/);
  const interval = Number(/AUTOPLAY_MS = (\d+)/.exec(source)?.[1]);
  assert.ok(interval >= 4000 && interval <= 5000);
  assert.match(source, /RESUME_AFTER_INTERACTION_MS/);
  for (const handler of ['onPointerDown', 'onTouchStart', 'onWheel', 'onKeyDown', 'onFocus']) assert.match(source, new RegExp(handler));
  assert.match(source, /document\.hidden/);
});

test('TrustStrip: nearestSlideIndex finds the slide closest to the scroll position', () => {
  assert.equal(nearestSlideIndex([0, 300, 600, 900], 0), 0);
  assert.equal(nearestSlideIndex([0, 300, 600, 900], 340), 1);
  assert.equal(nearestSlideIndex([0, 300, 600, 900], 880), 3);
});

test('TrustStrip: autoplay advances one slide at a time and stops at the end (never returns to 0)', () => {
  assert.equal(nextAutoplayIndex(0, 4, false), 1);
  assert.equal(nextAutoplayIndex(1, 4, false), 2);
  assert.equal(nextAutoplayIndex(2, 4, false), 3);
  assert.equal(nextAutoplayIndex(3, 4, false), null); // last slide: stop
  assert.equal(nextAutoplayIndex(2, 4, true), null); // scroller already at its end (last card cannot reach the start edge): stop
  assert.equal(nextAutoplayIndex(0, 1, false), null);
  // Simulate a whole run: it must never target slide 0 after having left it.
  let current = 0;
  const visited = [current];
  for (let guard = 0; guard < 20; guard += 1) {
    const next = nextAutoplayIndex(current, 4, false);
    if (next === null) break;
    assert.ok(next > current, 'always forward');
    current = next;
    visited.push(current);
  }
  assert.deepEqual(visited, [0, 1, 2, 3]);
});

test('TrustStrip: the component stops its interval at the end and has no wrap-around/rewind code', () => {
  assert.match(source, /next === null[\s\S]*window\.clearInterval\(timer\)/);
  assert.doesNotMatch(source, /%\s*count|% slides\.length|nextSlideIndex/);
  assert.doesNotMatch(source, /scrollTo\(\{\s*left:\s*0/);
});

test('TrustStrip: entrance stays between 400 and 700 ms and the scrollbar is hidden', () => {
  const duration = Number(/\.trust-strip \[data-reveal-item\] \{\s*transition-duration: (\d+)ms/.exec(css)?.[1]);
  assert.ok(duration >= 400 && duration <= 700);
  assert.match(css, /\.trust-scroller \{\s*scrollbar-width: none/);
  // Reduced motion is neutralised globally for every transition/animation.
  assert.match(css, /prefers-reduced-motion: reduce[\s\S]*transition-duration: 0\.01ms !important/);
});

test('TrustStrip: hover is a chromatic change on the whole card, only for a real mouse, with no movement', () => {
  // No legacy hover utilities (icon lift / text tint) in the component.
  assert.doesNotMatch(source, /hover:|group-hover|trust-item group|onMouseOver/);
  const hover = /@media \(hover: hover\) and \(pointer: fine\) \{([\s\S]*?)\n\}\n/.exec(css);
  assert.ok(hover, 'hover styles only exist for hover-capable fine pointers (never on touch)');
  const rules = hover[1];
  // Fill on its own layer (so the card keeps its reveal transition), darker brand tone for AA contrast.
  assert.match(rules, /\.trust-item::before \{[\s\S]*?background-color: rgb\(var\(--color-brand-hover\)\);[\s\S]*?opacity: 0;[\s\S]*?transition: opacity 250ms/);
  assert.match(rules, /\.trust-item:hover::before \{\s*opacity: 1;/);
  assert.match(rules, /\.trust-item:hover \.trust-icon,\s*\.trust-strip \.trust-item:hover \.trust-title \{\s*color: rgb\(255 255 255\);/);
  assert.match(rules, /\.trust-item:hover \.trust-text \{\s*color: rgb\(255 255 255 \/ 0\.9\);/);
  // Purely chromatic: no scale, translate, lift, shadow or glow.
  assert.doesNotMatch(rules, /transform|scale|translate|box-shadow|filter|drop-shadow/);
  // The card itself never gets a transition here (its reveal opacity/transform transition stays intact).
  assert.doesNotMatch(rules, /\.trust-item,\s*\n|\.trust-item \{[^}]*transition/);
  // Hooks used by the hover styles exist on every card (real and copies).
  for (const hook of ['trust-icon', 'trust-title', 'trust-text']) assert.ok((source.match(new RegExp(hook, 'g')) ?? []).length >= 2, hook);
});

test('TrustStrip: hovering the strip pauses the marquee in place (no reset) and resumes on leave', () => {
  const gate = /@media \(min-width: 1024px\) and \(prefers-reduced-motion: no-preference\) \{([\s\S]*?)\n\}\n/.exec(css);
  assert.ok(gate);
  assert.match(gate[1], /\.trust-frame:hover \.trust-scroller \{\s*animation-play-state: paused;/);
});

test('TrustStrip: desktop marquee copies are visual only (aria-hidden, no links, focus or headings)', () => {
  const markup = renderToStaticMarkup(React.createElement(TrustStrip));
  assert.equal(markup.split('trust-copy').length - 1, 8 * MARQUEE_COPIES);
  assert.equal((markup.match(/aria-hidden="true"[^>]*data-reveal-item[^>]*trust-copy/g) ?? []).length, 8 * MARQUEE_COPIES);
  assert.doesNotMatch(markup, /<a |<button|<input|href=/);
  assert.equal((markup.match(/tabindex/gi) ?? []).length, 0);
  // Copies use a paragraph for the title, so the heading outline lists each benefit once.
  assert.equal((markup.match(/<h2/g) ?? []).length, 8);
});

test('TrustStrip: the marquee is desktop-only, slow, seamless and disabled under reduced motion', () => {
  assert.match(css, /\.trust-strip \.trust-copy \{\s*display: none;/);
  const gate = /@media \(min-width: 1024px\) and \(prefers-reduced-motion: no-preference\) \{([\s\S]*?)\n\}\n/.exec(css);
  assert.ok(gate, 'marquee lives inside the desktop + no-preference media query');
  assert.match(gate[1], /animation: trust-marquee var\(--trust-marquee-duration\) linear infinite/);
  assert.match(gate[1], /\.trust-copy \{\s*display: flex;/);
  // Outside that query the animation is never applied.
  assert.equal((css.match(/animation: trust-marquee/g) ?? []).length, 1);
  // Same slow speed as before (~20px/s): 8 cards x 20rem = 2560px per 128s loop.
  assert.equal(Number(/--trust-marquee-duration: (\d+)s/.exec(css)?.[1]), 128);
  assert.match(css, /--trust-item-width: 20rem;/);
  // Seamless: one loop moves exactly the eight real cards, and 2 copies (16 cards) cover screens up to ~5000px.
  assert.match(css, /translateX\(calc\(var\(--trust-item-width\) \* -8\)\)/);
  assert.ok(MARQUEE_COPIES >= 2);
  // Linear timing: no easing and no rewind/alternate.
  assert.doesNotMatch(css, /animation: trust-marquee[^;]*(ease|alternate)/);
});

test('TrustStrip: the strip is painted in place under the hero from the start (no light gap while waiting to reveal)', () => {
  const landing = readFileSync(join(process.cwd(), 'src/pages/LandingPage.tsx'), 'utf8');
  assert.match(landing, /<Reveal className="reveal-anchored"><TrustStrip \/><\/Reveal>/);
  assert.match(css, /\.reveal-ready \.reveal-section\.reveal-anchored:not\(\.is-visible\) \{\s*opacity: 1;\s*transform: none;/);
  // The cards inside still keep their staggered entrance.
  assert.match(css, /\.reveal-ready \.reveal-section\.is-visible \.trust-strip \[data-reveal-item\] \{\s*transition-duration: 560ms;/);
});

test('TrustStrip: mobile/tablet carousel logic does not run on desktop or under reduced motion', () => {
  assert.match(source, /!isCarousel \|\| prefersReducedMotion/);
  assert.match(source, /tabIndex=\{isCarousel \? 0 : undefined\}/);
});
