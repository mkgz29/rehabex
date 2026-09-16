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
import { checkoutItemsForRequest } from '../../src/services/checkoutService.ts';

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
  items = increaseCartItem(items, product.productId);
  items = increaseCartItem(items, product.productId);
  items = increaseCartItem(items, product.productId);
  assert.equal(items[0]?.quantity, 3);

  items = decreaseCartItem(items, product.productId);
  items = decreaseCartItem(items, product.productId);
  items = decreaseCartItem(items, product.productId);
  assert.equal(items[0]?.quantity, 1);
});

test('rechaza cantidades invalidas, productos sin stock y elimina o vacia items de forma explicita', () => {
  assert.equal(addCartItem([], { ...testProduct, quantity: 0 }).result, 'invalid_item');
  assert.equal(addCartItem([], { ...testProduct, availableStock: 0 }).result, 'unavailable');

  const items = addCartItem([], testProduct).items;
  assert.deepEqual(removeCartItem(items, testProduct.productId), []);
  assert.deepEqual(removeCartItem([], testProduct.productId), []);
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
