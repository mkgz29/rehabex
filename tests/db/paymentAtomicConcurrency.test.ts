import assert from 'node:assert/strict';
import test from 'node:test';

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.ATOMIC_TEST_SUPABASE_URL ?? process.env.SUPABASE_URL ?? process.env.API_URL ?? '';
const serviceRoleKey = process.env.ATOMIC_TEST_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SERVICE_ROLE_KEY ?? '';
const host = (() => { try { return new URL(supabaseUrl).hostname; } catch { return ''; } })();

if (!['127.0.0.1', 'localhost'].includes(host) || !serviceRoleKey) {
  throw new Error('Concurrency test requires local Supabase credentials and refuses remote URLs.');
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

test('old backend two-step RPCs remain functional with migration 106', async () => {
  const suffix = crypto.randomUUID();
  const productId = crypto.randomUUID();
  let orderId: string | null = null;
  const paymentId = `legacy-${suffix}`;

  try {
    const { error: productError } = await supabase.from('products').insert({
      id: productId,
      name: `Legacy rollout ${suffix}`,
      description: 'Local rollout fixture',
      category: 'test',
      price: 100,
      is_featured: false,
      display_order: 0,
      is_active: true,
      sku: `AT-LEG-${suffix}`,
      slug: `atomic-legacy-${suffix}`,
      currency: 'ARS',
      track_stock: true,
      allow_backorder: false,
      stock_on_hand: 2,
      low_stock_threshold: 0,
    });
    assert.equal(productError, null);

    const { data: created, error: checkoutError } = await supabase.rpc('create_checkout_order_v2', {
      p_idempotency_key: crypto.randomUUID(),
      p_checkout_request_hash: `legacy-${suffix}`,
      p_user_id: null,
      p_customer_email: 'legacy@example.test',
      p_customer_name: 'Legacy rollout',
      p_customer_phone: null,
      p_delivery_method: 'pickup',
      p_delivery_payload: {},
      p_items: [{ productId, quantity: 1 }],
      p_status_access_token_hash: `legacy-token-${suffix}`,
      p_reservation_minutes: 15,
    });
    assert.equal(checkoutError, null);
    orderId = String(created?.[0]?.order_id ?? '');
    assert.match(orderId, /^[0-9a-f-]{36}$/i);

    const preferenceId = `pref-legacy-${suffix}`;
    const { error: preferenceError } = await supabase.rpc('attach_mercadopago_preference', {
      p_order_id: orderId,
      p_preference_id: preferenceId,
      p_checkout_url: 'https://example.invalid/legacy',
    });
    assert.equal(preferenceError, null);

    const { data: event, error: eventError } = await supabase.rpc('record_mercadopago_payment_event', {
      p_dedupe_key: `legacy:${paymentId}:approved`,
      p_request_id: `legacy-request-${suffix}`,
      p_provider_event_id: null,
      p_provider_payment_id: paymentId,
      p_order_id: orderId,
      p_external_reference: orderId,
      p_payload_hash: `legacy-hash-${suffix}`,
      p_provider_status: 'approved',
    });
    assert.equal(eventError, null);
    const eventId = String(event?.[0]?.event_id ?? '');
    assert.match(eventId, /^[0-9a-f-]{36}$/i);

    const { data: outcome, error: transitionError } = await supabase.rpc('apply_mercadopago_payment_transition', {
      p_event_id: eventId,
      p_order_id: orderId,
      p_payment_id: paymentId,
      p_payment_status: 'approved',
      p_amount: 100,
      p_currency: 'ARS',
      p_external_reference: orderId,
      p_preference_id: preferenceId,
    });
    assert.equal(transitionError, null);
    assert.equal(outcome, 'approved');
  } finally {
    if (orderId) {
      await supabase.from('payment_events').delete().eq('provider_payment_id', paymentId);
      await supabase.from('inventory_movements').delete().eq('order_id', orderId);
      await supabase.from('orders').delete().eq('id', orderId);
    }
    await supabase.from('products').delete().eq('id', productId);
  }
});

test('concurrent webhook and reconciliation calls commit one transition', async () => {
  const suffix = crypto.randomUUID();
  const productId = crypto.randomUUID();
  let orderId: string | null = null;
  const paymentId = `concurrent-${suffix}`;

  try {
    const { error: productError } = await supabase.from('products').insert({
      id: productId,
      name: `Atomic concurrency ${suffix}`,
      description: 'Local concurrency fixture',
      category: 'test',
      price: 100,
      is_featured: false,
      display_order: 0,
      is_active: true,
      sku: `AT-CON-${suffix}`,
      slug: `atomic-concurrency-${suffix}`,
      currency: 'ARS',
      track_stock: true,
      allow_backorder: false,
      stock_on_hand: 2,
      low_stock_threshold: 0,
    });
    assert.equal(productError, null);

    const { data: created, error: checkoutError } = await supabase.rpc('create_checkout_order_v2', {
      p_idempotency_key: crypto.randomUUID(),
      p_checkout_request_hash: `concurrency-${suffix}`,
      p_user_id: null,
      p_customer_email: 'concurrency@example.test',
      p_customer_name: 'Concurrency Test',
      p_customer_phone: null,
      p_delivery_method: 'pickup',
      p_delivery_payload: {},
      p_items: [{ productId, quantity: 1 }],
      p_status_access_token_hash: `concurrency-token-${suffix}`,
      p_reservation_minutes: 15,
    });
    assert.equal(checkoutError, null);
    assert.equal(Array.isArray(created), true);
    orderId = String(created?.[0]?.order_id ?? '');
    assert.match(orderId, /^[0-9a-f-]{36}$/i);

    const preferenceId = `pref-concurrent-${suffix}`;
    const { error: preferenceError } = await supabase.rpc('attach_mercadopago_preference', {
      p_order_id: orderId,
      p_preference_id: preferenceId,
      p_checkout_url: 'https://example.invalid/concurrent',
    });
    assert.equal(preferenceError, null);

    const input = {
      p_provider_payment_id: paymentId,
      p_external_reference: orderId,
      p_preference_id: preferenceId,
      p_payment_status: 'approved',
      p_amount: 100,
      p_currency: 'ARS',
      p_live_mode: false,
    };
    const [webhook, reconciliation] = await Promise.all([
      supabase.rpc('process_mercadopago_payment_atomic', {
        ...input,
        p_request_id: `webhook-${suffix}`,
        p_payload_hash: `hash-webhook-${suffix}`,
      }),
      supabase.rpc('process_mercadopago_payment_atomic', {
        ...input,
        p_request_id: null,
        p_payload_hash: `hash-reconcile-${suffix}`,
      }),
    ]);
    assert.equal(webhook.error, null);
    assert.equal(reconciliation.error, null);
    const outcomes = [webhook.data?.[0]?.outcome, reconciliation.data?.[0]?.outcome].sort();
    assert.deepEqual(outcomes, ['approved', 'duplicate']);

    const [{ data: product }, { count: events }, { count: movements }, { data: order }] = await Promise.all([
      supabase.from('products').select('stock_on_hand').eq('id', productId).single(),
      supabase.from('payment_events').select('id', { count: 'exact', head: true }).eq('provider_payment_id', paymentId).eq('provider_status', 'approved'),
      supabase.from('inventory_movements').select('id', { count: 'exact', head: true }).eq('order_id', orderId).eq('movement_type', 'sale'),
      supabase.from('orders').select('payment_status,order_status').eq('id', orderId).single(),
    ]);
    assert.equal(product?.stock_on_hand, 1);
    assert.equal(events, 1);
    assert.equal(movements, 1);
    assert.deepEqual(order, { payment_status: 'approved', order_status: 'confirmed' });
  } finally {
    if (orderId) {
      await supabase.from('payment_events').delete().eq('provider_payment_id', paymentId);
      await supabase.from('inventory_movements').delete().eq('order_id', orderId);
      await supabase.from('orders').delete().eq('id', orderId);
    }
    await supabase.from('products').delete().eq('id', productId);
  }
});
