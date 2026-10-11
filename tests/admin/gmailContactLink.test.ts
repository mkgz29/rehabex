import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as React from 'react';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';

import { GmailContactLink } from '../../src/admin/components/GmailContactLink.tsx';
import { buildGmailComposeUrl, buildSupportEmailBody, buildSupportEmailSubject } from '../../src/admin/emailContact.ts';

(globalThis as typeof globalThis & { React: typeof React }).React = React;

function render(props: Partial<React.ComponentProps<typeof GmailContactLink>> = {}) {
  return renderToStaticMarkup(
    React.createElement(GmailContactLink, { email: 'cliente@example.test', customerName: 'Ana Gómez', subject: 'No llego mi pedido', ...props }),
  );
}

test('a valid email renders a "Contactar por Gmail" link', () => {
  const markup = render();
  assert.match(markup, />Contactar por Gmail</);
  assert.match(markup, /<a[^>]*href="https:\/\/mail\.google\.com\/mail\/\?/);
});

test('the recipient is the ticket\'s own customerEmail', () => {
  const markup = render({ email: 'otro@example.test' });
  const hrefMatch = /href="([^"]*)"/.exec(markup);
  const decoded = new URL(hrefMatch![1].replace(/&amp;/g, '&'));
  assert.equal(decoded.searchParams.get('to'), 'otro@example.test');
});

test('the subject matches buildSupportEmailSubject for this ticket', () => {
  const markup = render({ subject: 'Mi pedido no llego' });
  const hrefMatch = /href="([^"]*)"/.exec(markup);
  const decoded = new URL(hrefMatch![1].replace(/&amp;/g, '&'));
  assert.equal(decoded.searchParams.get('su'), buildSupportEmailSubject('Mi pedido no llego'));
});

test('an absent subject falls back to the base "Consulta Rehabex" subject', () => {
  const markup = render({ subject: null });
  const hrefMatch = /href="([^"]*)"/.exec(markup);
  const decoded = new URL(hrefMatch![1].replace(/&amp;/g, '&'));
  assert.equal(decoded.searchParams.get('su'), 'Consulta Rehabex');
});

test('the body greets the customer by name, matching buildSupportEmailBody', () => {
  const markup = render({ customerName: 'Juan Perez' });
  const hrefMatch = /href="([^"]*)"/.exec(markup);
  const decoded = new URL(hrefMatch![1].replace(/&amp;/g, '&'));
  assert.equal(decoded.searchParams.get('body'), buildSupportEmailBody('Juan Perez'));
});

test('an invalid email renders nothing -- never a broken link', () => {
  assert.equal(render({ email: 'not-an-email' }), '');
});

test('no email at all renders nothing', () => {
  assert.equal(render({ email: undefined }), '');
  assert.equal(render({ email: null }), '');
  assert.equal(render({ email: '' }), '');
});

test('the link opens in a new tab with noopener/noreferrer, never same-tab navigation', () => {
  const markup = render();
  assert.match(markup, /target="_blank"/);
  assert.match(markup, /rel="noopener noreferrer"/);
});

test('matches buildGmailComposeUrl exactly, end to end', () => {
  const markup = render({ email: 'cliente@example.test', customerName: 'Ana Gómez', subject: 'No llego mi pedido' });
  const expected = buildGmailComposeUrl('cliente@example.test', buildSupportEmailSubject('No llego mi pedido'), buildSupportEmailBody('Ana Gómez'));
  const hrefMatch = /href="([^"]*)"/.exec(markup);
  assert.equal(hrefMatch![1].replace(/&amp;/g, '&'), expected);
});

// --- security contract ---------------------------------------------------------

test('SECURITY CONTRACT: GmailContactLink.tsx never imports fetch/adminApi/Supabase and never mutates anything', () => {
  const content = readFileSync(join(process.cwd(), 'src/admin/components/GmailContactLink.tsx'), 'utf8');
  assert.doesNotMatch(content, /from ['"]@supabase|createClient|\.rpc\(/);
  assert.doesNotMatch(content, /adminApi|updateSupportRequestStatus|updateSupportRequestNotes/);
  assert.doesNotMatch(content, /\bfetch\(/);
});
