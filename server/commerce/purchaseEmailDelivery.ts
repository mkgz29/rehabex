// FASE 7E-B2: orchestrates claim -> snapshot -> template -> provider -> mark
// for the purchase-confirmation email. This is the ONLY module that ties the
// email-foundation RPCs (FASE 7E-B1), the pure template (purchaseEmail.ts)
// and the provider (emailProvider.ts) together, and it is called from
// exactly one place: paymentConfirmation.ts, after the atomic payment RPC
// has already committed. Every exit path either sends nothing or calls
// mark_order_email_sent/mark_order_email_failed -- there is no path where a
// claim is taken and silently abandoned.
import { backendUrls, logEvent } from './commerce.js';
import { loadEmailProviderConfig, sendTransactionalEmail } from './emailProvider.js';
import {
  buildPurchaseConfirmationHtml,
  buildPurchaseConfirmationSubject,
  buildPurchaseConfirmationText,
  buildSupportUrl,
  type PurchaseEmailData,
  type PurchaseEmailDeliveryMethod,
  type PurchaseEmailItemSnapshot,
  type PurchaseEmailOrderSnapshot,
} from './purchaseEmail.js';
import type { PaymentProcessResult } from './paymentProcessing.js';

export const PURCHASE_CONFIRMATION_EMAIL_TYPE = 'purchase_confirmation';

/**
 * The one condition under which the purchase-confirmation email may ever be
 * considered: the atomic RPC actually transitioned the payment to approved
 * AND the order to its normal confirmed state in the same call -- `status`
 * is the payment status requested, `transition` is what the RPC's own
 * `outcome` column returned. Any other combination (duplicate, rejected,
 * pending, review_refund_required, on_hold, ignored_invalid_transition, ...)
 * must never reach this far: `transition` only equals 'approved' on the
 * plain success path (see process_mercadopago_payment_atomic's final
 * `RETURN QUERY SELECT v_event.id, v_status, false`), never on the
 * late-stock-shortage path, which returns 'review_refund_required' instead.
 */
export function shouldSendPurchaseConfirmation(result: PaymentProcessResult): boolean {
  return result.kind === 'processed' && result.status === 'approved' && result.transition === 'approved';
}

type OrderEmailClaim = 'claimed' | 'already_sent' | 'already_processing' | 'error';

type OrderSnapshotRow = {
  order_number: string | null;
  customer_name: string | null;
  customer_email: string | null;
  subtotal_amount: number | string | null;
  shipping_amount: number | string | null;
  discount_amount: number | string | null;
  total_amount: number | string | null;
  delivery_method: string | null;
  delivery_recipient_name: string | null;
  delivery_address_line1: string | null;
  delivery_address_line2: string | null;
  delivery_city: string | null;
  delivery_province: string | null;
  delivery_postal_code: string | null;
  delivery_notes: string | null;
  pickup_location_label: string | null;
  pickup_window: string | null;
  payment_status: string | null;
  order_status: string | null;
};

type OrderItemRow = {
  product_name: string | null;
  product_sku: string | null;
  unit_price: number | string | null;
  quantity: number | null;
  line_total: number | string | null;
};

type OrderSnapshot = {
  order: PurchaseEmailOrderSnapshot;
  items: PurchaseEmailItemSnapshot[];
  paymentStatus: string | null;
  orderStatus: string | null;
  customerEmail: string;
};

function toNumber(value: number | string | null): number {
  const parsed = typeof value === 'number' ? value : Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Loads exactly `orders` + `order_items`, never `products` and never a
 * Mercado Pago call (FASE 7E-A, section 5 / FASE 7E-B2, section 6). Returns
 * null on any load failure -- the caller marks the attempt failed with a
 * sanitized code, it never throws a raw Supabase error upward.
 */
async function loadOrderEmailSnapshot(supabase: any, orderId: string): Promise<OrderSnapshot | null> {
  const { data: orderRow, error: orderError } = await supabase
    .from('orders')
    .select(
      'order_number, customer_name, customer_email, subtotal_amount, shipping_amount, discount_amount, total_amount, ' +
        'delivery_method, delivery_recipient_name, delivery_address_line1, delivery_address_line2, delivery_city, ' +
        'delivery_province, delivery_postal_code, delivery_notes, pickup_location_label, pickup_window, payment_status, order_status',
    )
    .eq('id', orderId)
    .maybeSingle();
  if (orderError || !orderRow) return null;

  const row = orderRow as OrderSnapshotRow;
  if (!row.order_number || !row.customer_name || !row.customer_email || !row.delivery_method) return null;
  if (row.delivery_method !== 'pickup' && row.delivery_method !== 'delivery') return null;

  const { data: itemRows, error: itemsError } = await supabase
    .from('order_items')
    .select('product_name, product_sku, unit_price, quantity, line_total')
    .eq('order_id', orderId)
    .order('created_at', { ascending: true });
  if (itemsError || !Array.isArray(itemRows)) return null;

  const items: PurchaseEmailItemSnapshot[] = (itemRows as OrderItemRow[]).map((item) => ({
    productName: item.product_name ?? '',
    productSku: item.product_sku,
    unitPrice: toNumber(item.unit_price),
    quantity: typeof item.quantity === 'number' ? item.quantity : Number(item.quantity ?? 0),
    lineTotal: toNumber(item.line_total),
  }));

  const order: PurchaseEmailOrderSnapshot = {
    orderNumber: row.order_number,
    customerName: row.customer_name,
    customerEmail: row.customer_email,
    subtotalAmount: toNumber(row.subtotal_amount),
    shippingAmount: toNumber(row.shipping_amount),
    discountAmount: toNumber(row.discount_amount),
    totalAmount: toNumber(row.total_amount),
    deliveryMethod: row.delivery_method as PurchaseEmailDeliveryMethod,
    deliveryRecipientName: row.delivery_recipient_name,
    deliveryAddressLine1: row.delivery_address_line1,
    deliveryAddressLine2: row.delivery_address_line2,
    deliveryCity: row.delivery_city,
    deliveryProvince: row.delivery_province,
    deliveryPostalCode: row.delivery_postal_code,
    deliveryNotes: row.delivery_notes,
    pickupLocationLabel: row.pickup_location_label,
    pickupWindow: row.pickup_window,
  };

  return { order, items, paymentStatus: row.payment_status, orderStatus: row.order_status, customerEmail: row.customer_email };
}

async function claimOrderEmailDelivery(supabase: any, orderId: string, emailType: string): Promise<OrderEmailClaim> {
  const { data, error } = await supabase.rpc('claim_order_email_delivery', { p_order_id: orderId, p_email_type: emailType });
  const row = Array.isArray(data) && data.length === 1 ? (data[0] as { claim?: unknown }) : null;
  const claim = typeof row?.claim === 'string' ? row.claim : null;
  if (error || (claim !== 'claimed' && claim !== 'already_sent' && claim !== 'already_processing')) return 'error';
  return claim;
}

async function markOrderEmailSent(supabase: any, orderId: string, emailType: string, providerMessageId: string): Promise<void> {
  await supabase.rpc('mark_order_email_sent', { p_order_id: orderId, p_email_type: emailType, p_provider_message_id: providerMessageId });
}

async function markOrderEmailFailed(supabase: any, orderId: string, emailType: string, errorCode: string): Promise<void> {
  await supabase.rpc('mark_order_email_failed', { p_order_id: orderId, p_email_type: emailType, p_error_code: errorCode });
}

/**
 * The full post-approval email attempt. Called fire-and-forget-safe from
 * paymentConfirmation.ts: this function itself never throws (every branch
 * is inside the outer try/catch) and its return value carries no signal the
 * caller needs to act on -- the payment's own success was already decided
 * and committed before this runs.
 *
 * Logging is metadata-only throughout: order_id, email_type, claim outcome,
 * send outcome, error_code. Never customer_email, customer_name, subject,
 * html, text, the provider's raw response, or the API key.
 */
export async function deliverPurchaseConfirmationEmail(supabase: any, orderId: string): Promise<void> {
  const emailType = PURCHASE_CONFIRMATION_EMAIL_TYPE;
  try {
    const claim = await claimOrderEmailDelivery(supabase, orderId, emailType);
    logEvent('purchase_email_claim', { orderId, emailType, claim });
    if (claim !== 'claimed') return;

    const snapshot = await loadOrderEmailSnapshot(supabase, orderId);
    if (!snapshot) {
      await markOrderEmailFailed(supabase, orderId, emailType, 'snapshot_unavailable');
      logEvent('purchase_email_send', { orderId, emailType, outcome: 'failed', errorCode: 'snapshot_unavailable' });
      return;
    }

    // Defense in depth (FASE 7E-B2, section 6): re-check the just-loaded row
    // itself, independent of the in-memory result the caller already
    // decided on. A row that somehow isn't approved/confirmed by the time
    // it is read here must never be emailed as "confirmed".
    if (snapshot.paymentStatus !== 'approved' || snapshot.orderStatus !== 'confirmed') {
      await markOrderEmailFailed(supabase, orderId, emailType, 'order_not_confirmed');
      logEvent('purchase_email_send', { orderId, emailType, outcome: 'failed', errorCode: 'order_not_confirmed' });
      return;
    }

    const providerConfig = loadEmailProviderConfig();
    if (providerConfig.ok === false) {
      await markOrderEmailFailed(supabase, orderId, emailType, providerConfig.errorCode);
      logEvent('purchase_email_send', { orderId, emailType, outcome: 'failed', errorCode: providerConfig.errorCode });
      return;
    }

    let siteUrl: string;
    try {
      siteUrl = backendUrls().site;
    } catch {
      await markOrderEmailFailed(supabase, orderId, emailType, 'configuration_missing');
      logEvent('purchase_email_send', { orderId, emailType, outcome: 'failed', errorCode: 'configuration_missing' });
      return;
    }

    const data: PurchaseEmailData = { order: snapshot.order, items: snapshot.items, supportUrl: buildSupportUrl(siteUrl) };
    const sendResult = await sendTransactionalEmail(providerConfig.config.apiKey, {
      to: snapshot.customerEmail,
      from: providerConfig.config.from,
      replyTo: providerConfig.config.replyTo,
      subject: buildPurchaseConfirmationSubject(data.order),
      html: buildPurchaseConfirmationHtml(data),
      text: buildPurchaseConfirmationText(data),
    });

    if (sendResult.ok === true) {
      await markOrderEmailSent(supabase, orderId, emailType, sendResult.providerMessageId);
      logEvent('purchase_email_send', { orderId, emailType, outcome: 'sent' });
    } else {
      await markOrderEmailFailed(supabase, orderId, emailType, sendResult.errorCode);
      logEvent('purchase_email_send', { orderId, emailType, outcome: 'failed', errorCode: sendResult.errorCode });
    }
  } catch {
    // Absolute backstop: nothing above may ever propagate into the payment
    // confirmation path. If even this logging call's inputs are somehow
    // unsafe, swallow rather than risk an exception reaching the caller.
    try {
      logEvent('purchase_email_unexpected_error', { orderId, emailType });
    } catch {
      /* never let a logging failure escape either */
    }
  }
}
