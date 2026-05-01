import { createContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';

const CART_STORAGE_KEY = 'rehabex.cart';

export type CartItem = {
  productId: string;
  name: string;
  price: number;
  imageUrl: string;
  quantity: number;
};

type AddItemInput = Omit<CartItem, 'quantity'> & {
  quantity?: number;
};

type CartContextValue = {
  items: CartItem[];
  addItem: (item: AddItemInput) => void;
  removeItem: (productId: string) => void;
  increaseQuantity: (productId: string) => void;
  decreaseQuantity: (productId: string) => void;
  clearCart: () => void;
  totalItems: number;
  totalPrice: number;
};

export const CartContext = createContext<CartContextValue | null>(null);

type CartProviderProps = {
  children: ReactNode;
};

export function CartProvider({ children }: CartProviderProps) {
  const [items, setItems] = useState<CartItem[]>(() => loadCartItems());

  useEffect(() => {
    window.localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(items));
  }, [items]);

  const value = useMemo<CartContextValue>(() => {
    const totalItems = items.reduce((total, item) => total + item.quantity, 0);
    const totalPrice = items.reduce((total, item) => total + item.price * item.quantity, 0);

    return {
      items,
      addItem(item) {
        const price = Number(item.price);
        const quantity = Math.max(1, Math.floor(Number(item.quantity ?? 1)));

        if (!isUuid(item.productId)) {
          console.error('[cart] Product ID invalido para checkout. Se esperaba UUID de Supabase.', {
            productId: item.productId,
            name: item.name,
          });
          return;
        }

        if (!Number.isFinite(price) || price < 0) {
          return;
        }

        setItems((currentItems) => {
          const existingItem = currentItems.find((currentItem) => currentItem.productId === item.productId);

          if (existingItem) {
            return currentItems.map((currentItem) =>
              currentItem.productId === item.productId
                ? { ...currentItem, quantity: currentItem.quantity + quantity }
                : currentItem,
            );
          }

          return [
            ...currentItems,
            {
              productId: item.productId,
              name: item.name,
              price,
              imageUrl: item.imageUrl,
              quantity,
            },
          ];
        });
      },
      removeItem(productId) {
        setItems((currentItems) => currentItems.filter((item) => item.productId !== productId));
      },
      increaseQuantity(productId) {
        setItems((currentItems) =>
          currentItems.map((item) => (item.productId === productId ? { ...item, quantity: item.quantity + 1 } : item)),
        );
      },
      decreaseQuantity(productId) {
        setItems((currentItems) =>
          currentItems.flatMap((item) => {
            if (item.productId !== productId) {
              return [item];
            }

            const nextQuantity = item.quantity - 1;
            return nextQuantity >= 1 ? [{ ...item, quantity: nextQuantity }] : [];
          }),
        );
      },
      clearCart() {
        setItems([]);
      },
      totalItems,
      totalPrice,
    };
  }, [items]);

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

function loadCartItems() {
  if (typeof window === 'undefined') {
    return [] as CartItem[];
  }

  const rawCart = window.localStorage.getItem(CART_STORAGE_KEY);
  if (!rawCart) {
    return [] as CartItem[];
  }

  try {
    const parsed = JSON.parse(rawCart);
    if (!Array.isArray(parsed)) {
      return [] as CartItem[];
    }

    return parsed.flatMap((item) => {
      if (!item || typeof item !== 'object') {
        return [];
      }

      const rawItem = item as Partial<CartItem> & { id?: string };
      const productId = typeof rawItem.productId === 'string' ? rawItem.productId : rawItem.id;
      const price = Number(rawItem.price);
      const quantity = Math.max(1, Math.floor(Number(rawItem.quantity)));

      if (
        typeof productId !== 'string' ||
        !isUuid(productId) ||
        typeof rawItem.name !== 'string' ||
        typeof rawItem.imageUrl !== 'string' ||
        !Number.isFinite(price) ||
        price < 0 ||
        !Number.isFinite(quantity)
      ) {
        return [];
      }

      return [
        {
          productId,
          name: rawItem.name,
          price,
          imageUrl: rawItem.imageUrl,
          quantity,
        },
      ];
    });
  } catch {
    return [] as CartItem[];
  }
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
