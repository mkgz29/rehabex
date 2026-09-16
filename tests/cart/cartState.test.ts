import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CART_STORAGE_KEY,
  addCartItem,
  decreaseCartItem,
  increaseCartItem,
  loadCartItems,
  persistCartItems,
  removeCartItem,
} from '../../src/cart/cartState.ts';
import { createCheckoutSnapshot, lockedCartLineIds, loadCheckoutSnapshot, persistCheckoutSnapshot, releaseCheckoutSnapshot, removeConfirmedSnapshotItems } from '../../src/cart/checkoutSnapshot.ts';
import { checkoutItemsForRequest } from '../../src/services/checkoutService.ts';
import { orderIdFromRedirect } from '../../src/hooks/usePaymentResult.ts';
import { classifyPaymentConfirmation, requestOrderStatus } from '../../src/services/orderStatusService.ts';

const testProduct = {
  productId: 'b6dbdc4c-ef16-4e20-8198-75269f603a8d',
  name: 'TEST-MP-APRO-20260916',
  price: 100,
  imageUrl: null,
  availableStock: 1,
};

function memoryStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem(key: string) { return values.get(key) ?? null; },
    setItem(key: string, value: string) { values.set(key, value); },
    removeItem(key: string) { values.delete(key); },
  };
}

test('agrega un producto TEST desde tienda y lo conserva al navegar y recargar', () => {
  const added = addCartItem([], testProduct);
  assert.equal(added.result, 'added');
  assert.equal(added.items[0]?.productId, testProduct.productId);
  assert.equal(added.items[0]?.imageUrl, null);

  const storage = memoryStorage();
  persistCartItems(storage, added.items);
  assert.equal(storage.getItem(CART_STORAGE_KEY) !== null, true);

  // Recreating state twice represents route navigation and a StrictMode-safe reload.
  assert.deepEqual(loadCartItems(storage), added.items);
  assert.deepEqual(loadCartItems(storage), added.items);
});

test('acepta el mismo contrato UUID para un producto historico y uno TEST', () => {
  const historicProduct = {
    productId: '642971a4-8b47-4a21-8336-ff18520d4733',
    name: 'Producto historico',
    price: 200,
    imageUrl: 'https://example.invalid/producto.jpg',
    availableStock: 2,
  };
  const historic = addCartItem([], historicProduct);
  const current = addCartItem(historic.items, testProduct);

  assert.equal(historic.result, 'added');
  assert.equal(current.result, 'added');
  assert.deepEqual(current.items.map((item) => item.productId), [historicProduct.productId, testProduct.productId]);
});

test('incrementa, disminuye sin llegar a cero y respeta el stock visible', () => {
  const product = { ...testProduct, productId: '4d2af5af-2a89-4d96-aaf5-3a4f9a4c7b44', availableStock: 3 };
  let items = addCartItem([], product).items;
  const lineId = items[0]!.lineId;
  items = increaseCartItem(items, lineId);
  items = increaseCartItem(items, lineId);
  items = increaseCartItem(items, lineId);
  assert.equal(items[0]?.quantity, 3);

  items = decreaseCartItem(items, lineId);
  items = decreaseCartItem(items, lineId);
  items = decreaseCartItem(items, lineId);
  assert.equal(items[0]?.quantity, 1);
});

test('rechaza cantidades invalidas, productos sin stock y elimina o vacia items de forma explicita', () => {
  assert.equal(addCartItem([], { ...testProduct, quantity: 0 }).result, 'invalid_item');
  assert.equal(addCartItem([], { ...testProduct, availableStock: 0 }).result, 'unavailable');

  const items = addCartItem([], testProduct).items;
  assert.deepEqual(removeCartItem(items, items[0]!.lineId), []);
  assert.deepEqual(removeCartItem([], '00000000-0000-4000-8000-000000000000'), []);
});

test('descarta solamente payload localStorage invalido y conserva un payload versionado valido', () => {
  const invalidStorage = memoryStorage({ [CART_STORAGE_KEY]: '{not-json' });
  assert.deepEqual(loadCartItems(invalidStorage), []);

  const validItems = addCartItem([], testProduct).items;
  const validStorage = memoryStorage();
  persistCartItems(validStorage, validItems);
  assert.deepEqual(loadCartItems(validStorage), validItems);
});

test('el precio es solo de presentacion: checkout recibe UUID y cantidad para recalculo del servidor', () => {
  const items = addCartItem([], testProduct).items;
  assert.deepEqual(checkoutItemsForRequest(items), [{ productId: testProduct.productId, quantity: 1 }]);
});

test('snapshot versionado no guarda PII, bloquea la linea y approved elimina solo lo comprado de forma idempotente', () => {
  const item = addCartItem([], { ...testProduct, availableStock: 2 }).items[0]!;
  const orderId = '11111111-1111-4111-8111-111111111111';
  const snapshot = createCheckoutSnapshot(orderId, 'a'.repeat(43), [item], '2026-09-16T20:00:00.000Z');
  assert.ok(snapshot);
  assert.deepEqual(Object.keys(snapshot!).sort(), ['createdAt', 'lines', 'orderId', 'statusToken', 'version']);

  const session = memoryStorage();
  const local = memoryStorage();
  persistCheckoutSnapshot(session, local, snapshot!);
  assert.deepEqual(loadCheckoutSnapshot(session, orderId), snapshot);
  assert.equal(lockedCartLineIds(local).has(item.lineId), true);

  const addedLater = addCartItem([item], { ...testProduct, availableStock: 2 }, lockedCartLineIds(local));
  assert.equal(addedLater.result, 'added');
  assert.equal(addedLater.items.length, 2);
  assert.notEqual(addedLater.items[1]!.lineId, item.lineId);
  const confirmed = removeConfirmedSnapshotItems(addedLater.items, snapshot!);
  assert.deepEqual(confirmed.map((line) => line.lineId), [addedLater.items[1]!.lineId]);
  assert.deepEqual(removeConfirmedSnapshotItems(confirmed, snapshot!), confirmed);
  releaseCheckoutSnapshot(session, local, orderId);
  assert.equal(loadCheckoutSnapshot(session, orderId), null);
  assert.equal(lockedCartLineIds(local).size, 0);
});

test('redirect falsificado no confirma pago; el backend decide approved, pending, rejected o unknown', async () => {
  const orderId = '11111111-1111-4111-8111-111111111111';
  assert.equal(orderIdFromRedirect(new URLSearchParams(`status=approved&payment_id=forged&external_reference=${orderId}`)), orderId);
  assert.equal(orderIdFromRedirect(new URLSearchParams('status=approved&external_reference=not-a-uuid')), null);
  assert.equal(classifyPaymentConfirmation({ payment_status: 'approved', order_status: 'confirmed' }), 'approved');
  assert.equal(classifyPaymentConfirmation({ payment_status: 'unpaid', order_status: 'pending_payment' }), 'pending');
  assert.equal(classifyPaymentConfirmation({ payment_status: 'rejected', order_status: 'pending_payment' }), 'rejected');
  assert.equal(classifyPaymentConfirmation({ payment_status: 'approved', order_status: 'on_hold' }), 'unknown');

  const snapshot = createCheckoutSnapshot(orderId, 'a'.repeat(43), addCartItem([], testProduct).items)!;
  const response = await requestOrderStatus(snapshot, (async (_input, init) => {
    assert.equal(init?.headers?.['X-Order-Status-Token'], 'a'.repeat(43));
    return new Response(JSON.stringify({ order: { payment_status: 'approved', order_status: 'confirmed' } }), { status: 200 });
  }) as typeof fetch);
  assert.equal(response, 'approved');
  const networkFailure = await requestOrderStatus(snapshot, (async () => { throw new Error('offline'); }) as typeof fetch).catch(() => 'unknown');
  assert.equal(networkFailure, 'unknown');
});
