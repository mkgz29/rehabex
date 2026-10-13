// FASE 7F-B4. Pure logic for the "Ver mi pedido" link: orderId + tracking
// token travel in the URL *fragment* (`#...`), never a query string -- a
// fragment is never sent to the server in the request line, never appears
// in standard server/CDN access logs, and browsers strip it from the
// Referer header on navigation. No new transport mechanism, no server-side
// token storage beyond what FASE 7F-B4's migration already adds
// (orders.tracking_token_hash) -- this only encodes/decodes the two opaque
// values the existing /api/order-status already knows how to check.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TOKEN = /^[A-Za-z0-9_-]{43}$/;

export function buildOrderTrackingFragment(orderId: string, token: string): string {
  return `${orderId}.${token}`;
}

export function buildOrderTrackingUrl(siteUrl: string, orderId: string, token: string): string {
  return `${siteUrl.replace(/\/$/, '')}/mi-pedido#${buildOrderTrackingFragment(orderId, token)}`;
}

export type ParsedOrderTracking = { orderId: string; token: string };

/** Returns null for anything malformed -- the caller treats that exactly like "no order found", never a crash. */
export function parseOrderTrackingFragment(fragment: string): ParsedOrderTracking | null {
  const value = fragment.startsWith('#') ? fragment.slice(1) : fragment;
  const dot = value.indexOf('.');
  if (dot <= 0) return null;
  const orderId = value.slice(0, dot);
  const token = value.slice(dot + 1);
  if (!UUID.test(orderId) || !TOKEN.test(token)) return null;
  return { orderId, token };
}
