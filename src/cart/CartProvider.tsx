import { createContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';

import {
  CART_STORAGE_KEY,
  addCartItem,
  decreaseCartItem,
  increaseCartItem,
  loadCartItems,
  persistCartItems,
  removeCartItem,
} from './cartState';
import type { AddItemInput, AddItemResult, CartItem } from './cartState';
import { lockedCartLineIds, releaseCheckoutSnapshot, removeConfirmedSnapshotItems, type CheckoutSnapshot } from './checkoutSnapshot';

export type { AddItemInput, AddItemResult, CartItem } from './cartState';

type CartContextValue = {
  items: CartItem[];
  addItem: (item: AddItemInput) => AddItemResult;
  removeItem: (lineId: string) => void;
  increaseQuantity: (lineId: string) => void;
  decreaseQuantity: (lineId: string) => void;
  clearCart: () => void;
  isLineLocked: (lineId: string) => boolean;
  confirmCheckout: (snapshot: CheckoutSnapshot) => void;
  releaseCheckout: (snapshot: CheckoutSnapshot) => void;
  totalItems: number;
  totalPrice: number;
};

export const CartContext = createContext<CartContextValue | null>(null);

type CartProviderProps = { children: ReactNode };

export function CartProvider({ children }: CartProviderProps) {
  const [items, setItems] = useState<CartItem[]>(() => typeof window === 'undefined' ? [] : loadCartItems(window.localStorage));

  useEffect(() => {
    try {
      persistCartItems(window.localStorage, items);
    } catch {
      // Storage can be unavailable or full. Keep the in-memory cart usable.
    }
  }, [items]);

  useEffect(() => {
    const sync = (event: StorageEvent) => {
      if (event.key === CART_STORAGE_KEY && event.storageArea === window.localStorage) setItems(loadCartItems(window.localStorage));
    };
    window.addEventListener('storage', sync);
    return () => window.removeEventListener('storage', sync);
  }, []);

  const value = useMemo<CartContextValue>(() => {
    const totalItems = items.reduce((total, item) => total + item.quantity, 0);
    const totalPrice = items.reduce((total, item) => total + item.price * item.quantity, 0);

    return {
      items,
      addItem(item) {
        const next = addCartItem(items, item, lockedCartLineIds(window.localStorage));
        if (next.result === 'added') setItems(next.items);
        return next.result;
      },
      removeItem(lineId) { if (!lockedCartLineIds(window.localStorage).has(lineId)) setItems((current) => removeCartItem(current, lineId)); },
      increaseQuantity(lineId) { if (!lockedCartLineIds(window.localStorage).has(lineId)) setItems((current) => increaseCartItem(current, lineId)); },
      decreaseQuantity(lineId) { if (!lockedCartLineIds(window.localStorage).has(lineId)) setItems((current) => decreaseCartItem(current, lineId)); },
      clearCart() { setItems((current) => current.filter((item) => lockedCartLineIds(window.localStorage).has(item.lineId))); },
      isLineLocked(lineId) { return lockedCartLineIds(window.localStorage).has(lineId); },
      confirmCheckout(snapshot) {
        setItems((current) => removeConfirmedSnapshotItems(current, snapshot));
        releaseCheckoutSnapshot(window.sessionStorage, window.localStorage, snapshot.orderId);
      },
      releaseCheckout(snapshot) { releaseCheckoutSnapshot(window.sessionStorage, window.localStorage, snapshot.orderId); },
      totalItems,
      totalPrice,
    };
  }, [items]);

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}
