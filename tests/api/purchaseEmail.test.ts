import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

import {
  buildPurchaseConfirmationHtml,
  buildPurchaseConfirmationSubject,
  buildPurchaseConfirmationText,
  buildSupportUrl,
  escapeHtml,
  type PurchaseEmailData,
  type PurchaseEmailItemSnapshot,
  type PurchaseEmailOrderSnapshot,
} from '../../server/commerce/purchaseEmail.js';

const BASE_ORDER: PurchaseEmailOrderSnapshot = {
  orderNumber: 'RHB-202610-000123',
  customerName: 'Ana Pérez',
  customerEmail: 'ana@example.test',
  subtotalAmount: 10000,
  shippingAmount: 0,
  discountAmount: 0,
  totalAmount: 10000,
  deliveryMethod: 'pickup',
  deliveryRecipientName: null,
  deliveryAddressLine1: null,
  deliveryAddressLine2: null,
  deliveryCity: null,
  deliveryProvince: null,
  deliveryPostalCode: null,
  deliveryNotes: null,
  pickupLocationLabel: 'Sucursal Centro',
  pickupWindow: 'Lun a vie, 10 a 18 hs',
};

const BASE_ITEMS: PurchaseEmailItemSnapshot[] = [
  { productName: 'Rodillera ortopédica', productSku: 'ROD-01', unitPrice: 5000, quantity: 2, lineTotal: 10000 },
];

function buildData(overrides: Partial<PurchaseEmailData> = {}): PurchaseEmailData {
  return { order: BASE_ORDER, items: BASE_ITEMS, supportUrl: 'https://rehabex.example/soporte', ...overrides };
}

// --- subject -------------------------------------------------------------

test('buildPurchaseConfirmationSubject includes the order number, exact copy', () => {
  assert.equal(buildPurchaseConfirmationSubject(BASE_ORDER), 'Tu compra en Rehabex fue confirmada — RHB-202610-000123');
});

// --- buildSupportUrl -------------------------------------------------------

test('buildSupportUrl builds an absolute /soporte URL from the given site origin, never a hardcoded domain', () => {
  assert.equal(buildSupportUrl('https://rehabex.example'), 'https://rehabex.example/soporte');
  assert.equal(buildSupportUrl('https://rehabex.example/'), 'https://rehabex.example/soporte');
});

// --- text/plain ------------------------------------------------------------

test('text: includes the order number, every item with quantity/unit price/line total, and the total', () => {
  const text = buildPurchaseConfirmationText(buildData());
  assert.match(text, /RHB-202610-000123/);
  assert.match(text, /Rodillera ortopédica x2/);
  assert.match(text, /\$\s?5\.000/); // unit price
  assert.match(text, /\$\s?10\.000/); // line total / total
});

test('text: shipping line only appears when shippingAmount > 0', () => {
  const withoutShipping = buildPurchaseConfirmationText(buildData());
  assert.doesNotMatch(withoutShipping, /Envío:/);
  const withShipping = buildPurchaseConfirmationText(buildData({ order: { ...BASE_ORDER, shippingAmount: 1500, totalAmount: 11500 } }));
  assert.match(withShipping, /Envío: \$\s?1\.500/);
});

test('text: discount line only appears when discountAmount > 0', () => {
  const withoutDiscount = buildPurchaseConfirmationText(buildData());
  assert.doesNotMatch(withoutDiscount, /Descuento:/);
  const withDiscount = buildPurchaseConfirmationText(buildData({ order: { ...BASE_ORDER, discountAmount: 500, totalAmount: 9500 } }));
  assert.match(withDiscount, /Descuento: -\$\s?500/);
});

test('text: pickup shows location and window, never "null"/"undefined"/blank lines', () => {
  const text = buildPurchaseConfirmationText(buildData());
  assert.match(text, /Retiro en local:/);
  assert.match(text, /Sucursal Centro/);
  assert.match(text, /Lun a vie, 10 a 18 hs/);
  assert.doesNotMatch(text, /null|undefined/i);
});

test('text: pickup omits the window line when absent, without leaving a blank line', () => {
  const text = buildPurchaseConfirmationText(buildData({ order: { ...BASE_ORDER, pickupWindow: null } }));
  assert.match(text, /Sucursal Centro/);
  assert.doesNotMatch(text, /null|undefined/i);
});

test('text: delivery shows only the non-empty address fields, city+province joined on one line', () => {
  const deliveryOrder: PurchaseEmailOrderSnapshot = {
    ...BASE_ORDER,
    deliveryMethod: 'delivery',
    deliveryRecipientName: 'Ana Pérez',
    deliveryAddressLine1: 'Av. Siempre Viva 123',
    deliveryAddressLine2: null,
    deliveryCity: 'Córdoba',
    deliveryProvince: 'Córdoba',
    deliveryPostalCode: '5000',
    deliveryNotes: null,
    pickupLocationLabel: null,
    pickupWindow: null,
  };
  const text = buildPurchaseConfirmationText(buildData({ order: deliveryOrder }));
  assert.match(text, /Envío a domicilio:/);
  assert.match(text, /Av\. Siempre Viva 123/);
  assert.match(text, /Córdoba, Córdoba/);
  assert.match(text, /5000/);
  assert.doesNotMatch(text, /null|undefined/i);
});

test('text: delivery_notes only appears when present', () => {
  const withoutNotes = buildPurchaseConfirmationText(
    buildData({ order: { ...BASE_ORDER, deliveryMethod: 'delivery', deliveryAddressLine1: 'x', deliveryCity: 'y', deliveryProvince: 'z', deliveryPostalCode: '1', deliveryNotes: null } }),
  );
  assert.ok(!withoutNotes.includes('Tocar timbre'));
  const withNotes = buildPurchaseConfirmationText(
    buildData({ order: { ...BASE_ORDER, deliveryMethod: 'delivery', deliveryAddressLine1: 'x', deliveryCity: 'y', deliveryProvince: 'z', deliveryPostalCode: '1', deliveryNotes: 'Tocar timbre' } }),
  );
  assert.match(withNotes, /Tocar timbre/);
});

test('text: includes the support URL exactly as given', () => {
  const text = buildPurchaseConfirmationText(buildData());
  assert.match(text, /https:\/\/rehabex\.example\/soporte/);
});

// --- HTML --------------------------------------------------------------------

test('html: includes the order number, items, totals and delivery, same data as the text version', () => {
  const html = buildPurchaseConfirmationHtml(buildData());
  assert.match(html, /RHB-202610-000123/);
  assert.match(html, /Rodillera ortop&eacute;dica|Rodillera ortopédica/);
  assert.match(html, /Sucursal Centro/);
  assert.match(html, /<!doctype html>/i);
});

test('html: shipping/discount rows only render when > 0', () => {
  const plain = buildPurchaseConfirmationHtml(buildData());
  assert.doesNotMatch(plain, />Envío</);
  assert.doesNotMatch(plain, />Descuento</);
  const withBoth = buildPurchaseConfirmationHtml(buildData({ order: { ...BASE_ORDER, shippingAmount: 1000, discountAmount: 200, totalAmount: 10800 } }));
  assert.match(withBoth, />Envío</);
  assert.match(withBoth, />Descuento</);
});

test('html: escapes customer name, product name and address fields -- no raw HTML injection', () => {
  const malicious: PurchaseEmailOrderSnapshot = {
    ...BASE_ORDER,
    customerName: '<script>alert(1)</script>',
    deliveryMethod: 'delivery',
    deliveryAddressLine1: '<img src=x onerror=alert(1)>',
    deliveryCity: 'City & "Quotes"',
    deliveryProvince: "O'Province",
    deliveryPostalCode: '1000',
    pickupLocationLabel: null,
    pickupWindow: null,
  };
  const maliciousItems: PurchaseEmailItemSnapshot[] = [{ productName: '<b>Bold</b> & "quoted"', productSku: null, unitPrice: 100, quantity: 1, lineTotal: 100 }];
  const html = buildPurchaseConfirmationHtml(buildData({ order: malicious, items: maliciousItems }));
  assert.doesNotMatch(html, /<script>/);
  assert.doesNotMatch(html, /<img src=x onerror=/);
  assert.doesNotMatch(html, /<b>Bold<\/b>/);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.match(html, /&lt;b&gt;Bold&lt;\/b&gt;/);
  assert.match(html, /&amp;/);
  assert.match(html, /&quot;Quotes&quot;|&quot;quoted&quot;/);
  assert.match(html, /O&#39;Province/);
});

test('escapeHtml escapes all five significant characters', () => {
  assert.equal(escapeHtml(`<>&"'`), '&lt;&gt;&amp;&quot;&#39;');
});

// --- data boundary -----------------------------------------------------------

test('SECURITY CONTRACT: purchaseEmail.ts is pure template logic -- no fetch, no Supabase, no provider calls, no products lookup', () => {
  const source = readFileSync(join(process.cwd(), 'server/commerce/purchaseEmail.ts'), 'utf8');
  assert.doesNotMatch(source, /\bfetch\(/);
  assert.doesNotMatch(source, /from ['"]@supabase|createClient|\.rpc\(/);
  assert.doesNotMatch(source, /from\(['"]products['"]\)|\.from\s*\(\s*['"]products/i);
  assert.doesNotMatch(source, /mercadopago|payment_id|payer_email/i);
});

test('template never includes internal ids (order id, product id) or payment metadata -- only the order_number reference', () => {
  const text = buildPurchaseConfirmationText(buildData());
  const html = buildPurchaseConfirmationHtml(buildData());
  const uuidLike = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
  assert.doesNotMatch(text, uuidLike);
  assert.doesNotMatch(html, uuidLike);
});
