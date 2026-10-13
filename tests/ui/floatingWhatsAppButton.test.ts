import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

import { buildWhatsAppUrl } from '../../src/admin/whatsapp.js';

// --- link/message -------------------------------------------------------------

test('the fixed Rehabex WhatsApp number normalizes to the expected digits and builds the expected wa.me link', () => {
  const url = buildWhatsAppUrl('+5491158624811', 'Hola, vengo desde la web de Rehabex y quiero hacer una consulta.');
  assert.equal(url, 'https://wa.me/5491158624811?text=Hola%2C+vengo+desde+la+web+de+Rehabex+y+quiero+hacer+una+consulta.');
});

// --- component source contract ------------------------------------------------

test('CONTRACT: FloatingWhatsAppButton opens the link safely (new tab, no opener/referrer leak)', () => {
  const source = readFileSync(join(process.cwd(), 'src/components/FloatingWhatsAppButton.tsx'), 'utf8');
  assert.match(source, /target="_blank"/);
  assert.match(source, /rel="noopener noreferrer"/);
});

test('CONTRACT: FloatingWhatsAppButton has an accessible label and uses the real brand mark, not a generic icon, as its main visual', () => {
  const source = readFileSync(join(process.cwd(), 'src/components/FloatingWhatsAppButton.tsx'), 'utf8');
  assert.match(source, /aria-label="Contactar a Rehabex por WhatsApp"/);
  assert.match(source, /\/brand\/rehabex-mark-charcoal\.svg/);
});

test('CONTRACT: FloatingWhatsAppButton is pure presentation -- no fetch, no Supabase, no state/effect hooks', () => {
  const source = readFileSync(join(process.cwd(), 'src/components/FloatingWhatsAppButton.tsx'), 'utf8');
  assert.doesNotMatch(source, /\bfetch\(/);
  assert.doesNotMatch(source, /from ['"]@supabase|createClient/);
  assert.doesNotMatch(source, /\buseState\(|\buseEffect\(/);
});

test('CONTRACT: AppLayout (the public route wrapper) mounts the floating button; AdminLayout does not', () => {
  const appLayout = readFileSync(join(process.cwd(), 'src/components/AppLayout.tsx'), 'utf8');
  assert.match(appLayout, /FloatingWhatsAppButton/);
  const adminLayout = readFileSync(join(process.cwd(), 'src/admin/components/AdminLayout.tsx'), 'utf8');
  assert.doesNotMatch(adminLayout, /FloatingWhatsAppButton/);
});
