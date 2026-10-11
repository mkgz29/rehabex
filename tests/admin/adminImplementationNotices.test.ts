import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as React from 'react';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';

import {
  ADMIN_IMPLEMENTATION_NOTICES,
  NOTICE_VISIBILITY_DAYS,
  activeAdminImplementationNotices,
  isNoticeActive,
  type AdminImplementationNotice,
} from '../../src/admin/adminImplementationNotices.ts';
import { AdminImplementationNoticeCard } from '../../src/admin/components/AdminImplementationNoticeCard.tsx';

(globalThis as typeof globalThis & { React: typeof React }).React = React;

function notice(overrides: Partial<AdminImplementationNotice> = {}): AdminImplementationNotice {
  return {
    id: 'test-notice',
    title: 'Nuevo Centro de Soporte',
    message: 'Ahora podés recibir consultas desde la web y contactar a tus clientes por WhatsApp y Gmail.',
    publishedAt: '2026-10-11T00:00:00.000Z',
    ...overrides,
  };
}

// --- isNoticeActive / expiration ------------------------------------------------

test('a notice published today is active', () => {
  const published = new Date('2026-10-11T00:00:00.000Z');
  assert.equal(isNoticeActive(notice({ publishedAt: published.toISOString() }), published), true);
});

test('a notice is still active one day before its 21-day limit', () => {
  const published = new Date('2026-10-11T00:00:00.000Z');
  const justBefore = new Date(published.getTime() + (NOTICE_VISIBILITY_DAYS - 1) * 24 * 60 * 60 * 1000);
  assert.equal(isNoticeActive(notice({ publishedAt: published.toISOString() }), justBefore), true);
});

test('a notice disappears exactly at the 21-day boundary (not before, not lingering after)', () => {
  const published = new Date('2026-10-11T00:00:00.000Z');
  const exactLimit = new Date(published.getTime() + NOTICE_VISIBILITY_DAYS * 24 * 60 * 60 * 1000);
  assert.equal(isNoticeActive(notice({ publishedAt: published.toISOString() }), exactLimit), false);

  const oneMsBefore = new Date(exactLimit.getTime() - 1);
  assert.equal(isNoticeActive(notice({ publishedAt: published.toISOString() }), oneMsBefore), true);
});

test('a notice older than 21 days is no longer active', () => {
  const published = new Date('2026-10-11T00:00:00.000Z');
  const wayAfter = new Date(published.getTime() + 30 * 24 * 60 * 60 * 1000);
  assert.equal(isNoticeActive(notice({ publishedAt: published.toISOString() }), wayAfter), false);
});

// --- activeAdminImplementationNotices -------------------------------------------

test('activeAdminImplementationNotices returns only the still-active notices', () => {
  const now = new Date('2026-10-20T00:00:00.000Z');
  const active = notice({ id: 'a', publishedAt: '2026-10-11T00:00:00.000Z' });
  const expired = notice({ id: 'b', publishedAt: '2026-08-01T00:00:00.000Z' });
  assert.deepEqual(activeAdminImplementationNotices([active, expired], now).map((n) => n.id), ['a']);
});

test('when no notice is active, the result is an empty array', () => {
  const now = new Date('2027-01-01T00:00:00.000Z');
  const expired = notice({ publishedAt: '2026-01-01T00:00:00.000Z' });
  assert.deepEqual(activeAdminImplementationNotices([expired], now), []);
});

test('several active notices are capped at `max` (default 3), most recent first', () => {
  const now = new Date('2026-10-20T00:00:00.000Z');
  const notices = [
    notice({ id: 'oldest', publishedAt: '2026-10-01T00:00:00.000Z' }),
    notice({ id: 'newest', publishedAt: '2026-10-15T00:00:00.000Z' }),
    notice({ id: 'middle', publishedAt: '2026-10-10T00:00:00.000Z' }),
    notice({ id: 'fourth', publishedAt: '2026-10-05T00:00:00.000Z' }),
  ];
  const result = activeAdminImplementationNotices(notices, now, 3);
  assert.equal(result.length, 3);
  assert.deepEqual(result.map((n) => n.id), ['newest', 'middle', 'fourth']);
});

// --- card component: independent of the source ----------------------------------

test('AdminImplementationNoticeCard renders whatever title/message it is given, independent of where the data came from', () => {
  const markup = renderToStaticMarkup(
    React.createElement(AdminImplementationNoticeCard, { title: 'Título de prueba', message: 'Mensaje de prueba.' }),
  );
  assert.match(markup, /Título de prueba/);
  assert.match(markup, /Mensaje de prueba\./);
  assert.match(markup, /Nueva implementación/);
});

test('the card never shows a publication or expiration date, or any "quedan X días" countdown', () => {
  const markup = renderToStaticMarkup(
    React.createElement(AdminImplementationNoticeCard, { title: 'Nuevo Centro de Soporte', message: 'Mensaje.' }),
  );
  assert.doesNotMatch(markup, /quedan|vence|expira|publicad[oa]|\d{4}-\d{2}-\d{2}/i);
});

test('CONTRACT: the card never uses dangerouslySetInnerHTML -- title/message are always plain React text', () => {
  const content = readFileSync(join(process.cwd(), 'src/admin/components/AdminImplementationNoticeCard.tsx'), 'utf8');
  // Check actual JSX usage, not prose: this file's own doc comment
  // legitimately names dangerouslySetInnerHTML to explain why it's avoided.
  assert.doesNotMatch(content, /dangerouslySetInnerHTML=/);
});

// --- the real, shipped first notice ---------------------------------------------

test('the real ADMIN_IMPLEMENTATION_NOTICES ships exactly the approved first notice', () => {
  assert.equal(ADMIN_IMPLEMENTATION_NOTICES.length, 1);
  const first = ADMIN_IMPLEMENTATION_NOTICES[0];
  assert.equal(first.title, 'Nuevo Centro de Soporte');
  assert.equal(first.message, 'Ahora podés recibir consultas desde la web y contactar a tus clientes por WhatsApp y Gmail.');
  assert.ok(!Number.isNaN(new Date(first.publishedAt).getTime()), 'publishedAt must be a valid date');
});
