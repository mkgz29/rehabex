import { createContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';

import {
  addCartItem,
  decreaseCartItem,
  increaseCartItem,
  loadCartItems,
  persistCartItems,
  removeCartItem,
} from './cartState';
import type { AddItemInput, AddItemResult, CartItem } from './cartState';

export type { AddItemInput, AddItemResult, CartItem } from './cartState';

type CartContextValue = {
  items: CartItem[];
  addItem: (item: AddItemInput) => AddItemResult;
  removeItem: (productId: string) => void;
  increaseQuantity: (productId: string) => void;
  decreaseQuantity: (productId: string) => void;
  clearCart: () => void;
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

  const value = useMemo<CartContextValue>(() => {
    const totalItems = items.reduce((total, item) => total + item.quantity, 0);
    const totalPrice = items.reduce((total, item) => total + item.price * item.quantity, 0);

    return {
      items,
      addItem(item) {
        const next = addCartItem(items, item);
        if (next.result === 'added') setItems(next.items);
        return next.result;
      },
      removeItem(productId) { setItems((current) => removeCartItem(current, productId)); },
      increaseQuantity(productId) { setItems((current) => increaseCartItem(current, productId)); },
      decreaseQuantity(productId) { setItems((current) => decreaseCartItem(current, productId)); },
      clearCart() { setItems([]); },
      totalItems,
      totalPrice,
    };
  }, [items]);

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}
