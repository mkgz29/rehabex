import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

// FASE 7E-B2, section 15: the Resend API key and the provider module itself
// must never reach the frontend. This mirrors the existing SECURITY CONTRACT
// pattern already used for Cloudinary/Mercado Pago secrets in this suite.

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.isFile()) out.push(full);
  }
  return out;
}

const SRC_ROOT = join(process.cwd(), 'src');
const SRC_FILES = walk(SRC_ROOT).filter((f) => /\.(ts|tsx)$/.test(f));

test('SECURITY CONTRACT: no source file under src/ references EMAIL_PROVIDER_API_KEY, EMAIL_FROM or EMAIL_REPLY_TO', () => {
  for (const file of SRC_FILES) {
    const content = readFileSync(file, 'utf8');
    assert.doesNotMatch(content, /EMAIL_PROVIDER_API_KEY|EMAIL_FROM\b|EMAIL_REPLY_TO/, `${file} references a server-only email env var`);
  }
});

test('SECURITY CONTRACT: no source file under src/ imports emailProvider.ts or purchaseEmailDelivery.ts', () => {
  for (const file of SRC_FILES) {
    const content = readFileSync(file, 'utf8');
    assert.doesNotMatch(content, /emailProvider(\.js)?['"]/, `${file} imports the server-only email provider module`);
    assert.doesNotMatch(content, /purchaseEmailDelivery(\.js)?['"]/, `${file} imports the server-only email delivery orchestration`);
  }
});

test('SECURITY CONTRACT: no VITE_EMAIL_* variable exists anywhere in the repo (env example, src, server, api)', () => {
  for (const file of [...SRC_FILES, join(process.cwd(), '.env.example'), ...walk(join(process.cwd(), 'server')), ...walk(join(process.cwd(), 'api'))]) {
    if (!/\.(ts|tsx)$/.test(file) && !file.endsWith('.env.example')) continue;
    const content = readFileSync(file, 'utf8');
    assert.doesNotMatch(content, /VITE_EMAIL_/, `${file} references a VITE_EMAIL_* variable, which would ship to the browser`);
  }
});

test('SECURITY CONTRACT: emailProvider.ts and purchaseEmailDelivery.ts live only under server/commerce', () => {
  assert.ok(existsSync(join(process.cwd(), 'server/commerce/emailProvider.ts')));
  assert.ok(existsSync(join(process.cwd(), 'server/commerce/purchaseEmailDelivery.ts')));
  assert.ok(!existsSync(join(process.cwd(), 'src/commerce/emailProvider.ts')));
});

test('SECURITY CONTRACT: if a production build exists, the bundled frontend never contains the Resend API key or the Resend endpoint', () => {
  const distIndexCandidates = walk(join(process.cwd(), 'dist')).filter((f) => f.endsWith('.js') || f.endsWith('.html'));
  if (distIndexCandidates.length === 0) return; // no build artifact present in this environment; nothing to check
  const apiKey = process.env.EMAIL_PROVIDER_API_KEY;
  for (const file of distIndexCandidates) {
    const content = readFileSync(file, 'utf8');
    assert.doesNotMatch(content, /api\.resend\.com/, `${file} bundles the Resend API endpoint into the frontend`);
    if (apiKey) assert.doesNotMatch(content, new RegExp(apiKey.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `${file} leaked the configured API key`);
  }
});

test('SECURITY CONTRACT: .env.example documents the email vars as server-only, with no VITE_ prefix and REPLACE_IN_HOST_ONLY placeholders for secrets', () => {
  const content = readFileSync(join(process.cwd(), '.env.example'), 'utf8');
  assert.match(content, /^EMAIL_PROVIDER_API_KEY=REPLACE_IN_HOST_ONLY$/m);
  assert.match(content, /^EMAIL_FROM=REPLACE_IN_HOST_ONLY$/m);
  assert.doesNotMatch(content, /VITE_EMAIL/);
});
