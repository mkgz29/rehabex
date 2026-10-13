// FASE 7E-B1: pure template construction for the purchase-confirmation email.
// Nothing here sends anything -- there is no provider call, no fetch, no
// Supabase access. Every function is a pure string transform over the exact
// snapshot already persisted on `orders`/`order_items` at checkout time
// (FASE 7E-A, section 5): never `products` (prices/names could have changed
// since the sale) and never a Mercado Pago lookup.
//
// formatCurrency is reused from src/lib/format.ts rather than duplicated: it
// has zero imports of its own (just Intl.NumberFormat, a standard JS API with
// no browser/DOM dependency) and the whole commerce schema is ARS-only
// already (orders_currency_ars_check, order_items_currency_ars_check), so
// there is no second currency convention to keep in sync.
import { formatCurrency } from '../../src/lib/format.js';

export type PurchaseEmailDeliveryMethod = 'pickup' | 'delivery';

export type PurchaseEmailOrderSnapshot = {
  orderNumber: string;
  customerName: string;
  customerEmail: string;
  subtotalAmount: number;
  shippingAmount: number;
  discountAmount: number;
  totalAmount: number;
  deliveryMethod: PurchaseEmailDeliveryMethod;
  deliveryRecipientName: string | null;
  deliveryAddressLine1: string | null;
  deliveryAddressLine2: string | null;
  deliveryCity: string | null;
  deliveryProvince: string | null;
  deliveryPostalCode: string | null;
  deliveryNotes: string | null;
  pickupLocationLabel: string | null;
  pickupWindow: string | null;
};

export type PurchaseEmailItemSnapshot = {
  productName: string;
  productSku: string | null;
  unitPrice: number;
  quantity: number;
  lineTotal: number;
};

export type PurchaseEmailData = {
  order: PurchaseEmailOrderSnapshot;
  items: PurchaseEmailItemSnapshot[];
  /** Absolute URL to /soporte, built by the caller from PUBLIC_SITE_URL (see buildSupportUrl). Never hardcoded here. */
  supportUrl: string;
  /** FASE 7F-B4. Absolute /mi-pedido URL carrying the order id + a tracking token in the URL *fragment* (never a query string -- see src/lib/orderTrackingLink.ts for why). Optional: older callers/tests may omit it, in which case no "Ver mi pedido" link renders. */
  trackingUrl?: string;
};

/** Absolute /soporte URL from the same site origin checkout already uses (server/commerce/commerce.ts backendUrls().site) -- never a hardcoded production domain. */
export function buildSupportUrl(siteUrl: string): string {
  return `${siteUrl.replace(/\/$/, '')}/soporte`;
}

export function buildPurchaseConfirmationSubject(order: PurchaseEmailOrderSnapshot): string {
  return `Tu compra en Rehabex fue confirmada — ${order.orderNumber}`;
}

function nonEmpty(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

/** Pickup/delivery lines, skipping any field that is null/empty -- never a literal "null"/"undefined"/blank line (FASE 7E-B1, section 12). */
function deliveryLines(order: PurchaseEmailOrderSnapshot): string[] {
  if (order.deliveryMethod === 'pickup') {
    const lines: string[] = [];
    const location = nonEmpty(order.pickupLocationLabel);
    if (location) lines.push(location);
    const window = nonEmpty(order.pickupWindow);
    if (window) lines.push(window);
    return lines;
  }

  return [
    nonEmpty(order.deliveryRecipientName),
    nonEmpty(order.deliveryAddressLine1),
    nonEmpty(order.deliveryAddressLine2),
    [nonEmpty(order.deliveryCity), nonEmpty(order.deliveryProvince)].filter(Boolean).join(', ') || null,
    nonEmpty(order.deliveryPostalCode),
    nonEmpty(order.deliveryNotes),
  ].filter((line): line is string => Boolean(line));
}

function deliveryHeading(method: PurchaseEmailDeliveryMethod): string {
  return method === 'pickup' ? 'Retiro en local' : 'Envío a domicilio';
}

// --- text/plain ---------------------------------------------------------------

export function buildPurchaseConfirmationText(data: PurchaseEmailData): string {
  const { order, items, supportUrl, trackingUrl } = data;
  const lines: string[] = [];

  lines.push(`Hola ${order.customerName},`, '');
  lines.push('Tu pago fue aprobado. Este es el resumen de tu compra:', '');
  lines.push(`Pedido: ${order.orderNumber}`, '');
  if (trackingUrl) lines.push(`Ver mi pedido: ${trackingUrl}`, '');

  lines.push('Productos:');
  for (const item of items) {
    lines.push(`- ${item.productName} x${item.quantity} — ${formatCurrency(item.unitPrice)} c/u = ${formatCurrency(item.lineTotal)}`);
  }
  lines.push('');

  lines.push(`Subtotal: ${formatCurrency(order.subtotalAmount)}`);
  if (order.shippingAmount > 0) lines.push(`Envío: ${formatCurrency(order.shippingAmount)}`);
  if (order.discountAmount > 0) lines.push(`Descuento: -${formatCurrency(order.discountAmount)}`);
  lines.push(`Total: ${formatCurrency(order.totalAmount)}`, '');

  const delivery = deliveryLines(order);
  if (delivery.length > 0) {
    lines.push(deliveryHeading(order.deliveryMethod) + ':');
    lines.push(...delivery, '');
  }

  lines.push(`¿Dudas? Escribinos: ${supportUrl}`, '');
  lines.push('Rehabex');

  return lines.join('\n');
}

// --- HTML -----------------------------------------------------------------
//
// Transactional-email-safe HTML: no JS, no external stylesheet, only inline
// styles, a plain table for line items. Every value that originates from
// checkout input (customer name, product name, address lines, notes, pickup
// labels) is escaped -- none of it is trusted HTML (FASE 7E-B1, section 9).

/** Escapes the five HTML-significant characters. No arbitrary user HTML is ever permitted into this template. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function itemsTableHtml(items: PurchaseEmailItemSnapshot[]): string {
  const rows = items
    .map(
      (item) => `
      <tr>
        <td style="padding:8px 0;border-bottom:1px solid #e5e5e5;">${escapeHtml(item.productName)}</td>
        <td style="padding:8px 0;border-bottom:1px solid #e5e5e5;text-align:center;">${item.quantity}</td>
        <td style="padding:8px 0;border-bottom:1px solid #e5e5e5;text-align:right;">${escapeHtml(formatCurrency(item.unitPrice))}</td>
        <td style="padding:8px 0;border-bottom:1px solid #e5e5e5;text-align:right;">${escapeHtml(formatCurrency(item.lineTotal))}</td>
      </tr>`,
    )
    .join('');

  return `
    <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#1a1a1a;">
      <thead>
        <tr>
          <th align="left" style="padding:8px 0;border-bottom:2px solid #1a1a1a;">Producto</th>
          <th align="center" style="padding:8px 0;border-bottom:2px solid #1a1a1a;">Cant.</th>
          <th align="right" style="padding:8px 0;border-bottom:2px solid #1a1a1a;">Precio</th>
          <th align="right" style="padding:8px 0;border-bottom:2px solid #1a1a1a;">Subtotal</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`;
}

function totalsHtml(order: PurchaseEmailOrderSnapshot): string {
  const rows = [`<tr><td style="padding:2px 0;">Subtotal</td><td style="padding:2px 0;text-align:right;">${escapeHtml(formatCurrency(order.subtotalAmount))}</td></tr>`];
  if (order.shippingAmount > 0) {
    rows.push(`<tr><td style="padding:2px 0;">Envío</td><td style="padding:2px 0;text-align:right;">${escapeHtml(formatCurrency(order.shippingAmount))}</td></tr>`);
  }
  if (order.discountAmount > 0) {
    rows.push(`<tr><td style="padding:2px 0;">Descuento</td><td style="padding:2px 0;text-align:right;">-${escapeHtml(formatCurrency(order.discountAmount))}</td></tr>`);
  }
  rows.push(
    `<tr><td style="padding:6px 0 0;font-weight:bold;">Total</td><td style="padding:6px 0 0;text-align:right;font-weight:bold;">${escapeHtml(formatCurrency(order.totalAmount))}</td></tr>`,
  );
  return `<table width="100%" cellpadding="0" cellspacing="0" style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#1a1a1a;margin-top:12px;">${rows.join('')}</table>`;
}

function deliveryHtml(order: PurchaseEmailOrderSnapshot): string {
  const lines = deliveryLines(order);
  if (lines.length === 0) return '';
  const items = lines.map((line) => `<div>${escapeHtml(line)}</div>`).join('');
  return `
    <div style="margin-top:20px;font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#1a1a1a;">
      <strong>${escapeHtml(deliveryHeading(order.deliveryMethod))}</strong>
      <div style="margin-top:4px;color:#444;">${items}</div>
    </div>`;
}

export function buildPurchaseConfirmationHtml(data: PurchaseEmailData): string {
  const { order, items, supportUrl, trackingUrl } = data;
  return `<!doctype html>
<html lang="es">
  <body style="margin:0;padding:24px;background:#f6f5f3;font-family:Arial,Helvetica,sans-serif;">
    <div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:16px;padding:32px;">
      <p style="font-size:14px;color:#1a1a1a;margin:0 0 16px;">Hola ${escapeHtml(order.customerName)},</p>
      <p style="font-size:14px;color:#1a1a1a;margin:0 0 16px;">Tu pago fue aprobado. Este es el resumen de tu compra:</p>
      <p style="font-size:14px;color:#1a1a1a;margin:0 0 20px;"><strong>Pedido:</strong> ${escapeHtml(order.orderNumber)}</p>
      ${trackingUrl ? `<p style="margin:0 0 20px;"><a href="${escapeHtml(trackingUrl)}" style="display:inline-block;background:#1a1a1a;color:#ffffff;text-decoration:none;padding:10px 18px;border-radius:999px;font-size:13px;font-weight:bold;">Ver mi pedido</a></p>` : ''}
      ${itemsTableHtml(items)}
      ${totalsHtml(order)}
      ${deliveryHtml(order)}
      <p style="font-size:13px;color:#555;margin-top:24px;">¿Dudas? <a href="${escapeHtml(supportUrl)}" style="color:#1a1a1a;">Escribinos</a>.</p>
      <p style="font-size:12px;color:#999;margin-top:24px;">Rehabex</p>
    </div>
  </body>
</html>`;
}
