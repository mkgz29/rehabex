export const CART_STORAGE_KEY = 'rehabex.cart.v2';
const LEGACY_CART_STORAGE_KEY = 'rehabex.cart';
const CART_STORAGE_VERSION = 2;

export type CartItem = {
  lineId: string;
  productId: string;
  name: string;
  price: number;
  imageUrl: string | null;
  quantity: number;
  /** A UI cap from the public catalogue. The backend remains authoritative. */
  availableStock?: number;
};

export type AddItemInput = Omit<CartItem, 'lineId' | 'quantity'> & { quantity?: number; lineId?: string };
export type AddItemResult = 'added' | 'invalid_product' | 'invalid_item' | 'unavailable';

type StoredCart = { version: typeof CART_STORAGE_VERSION; items: CartItem[] };

export function addCartItem(items: CartItem[], input: AddItemInput, lockedLineIds: ReadonlySet<string> = new Set()): { items: CartItem[]; result: AddItemResult } {
  const item = normalizeAddItem(input);
  if (!item) return { items, result: 'invalid_item' };
  if (!isUuid(item.productId)) return { items, result: 'invalid_product' };
  if (item.availableStock === 0) return { items, result: 'unavailable' };

  const existing = items.find((current) => current.productId === item.productId && !lockedLineIds.has(current.lineId));
  const availableStock = item.availableStock ?? existing?.availableStock;
  const totalQuantity = items.filter((current) => current.productId === item.productId).reduce((total, current) => total + current.quantity, 0);
  const requestedQuantity = (existing?.quantity ?? 0) + item.quantity;
  const quantity = availableStock === undefined ? requestedQuantity : Math.min(requestedQuantity, Math.max(0, availableStock - (totalQuantity - (existing?.quantity ?? 0))));
  if (quantity <= (existing?.quantity ?? 0)) return { items, result: 'unavailable' };
  if (!existing) return { items: [...items, { ...item, quantity }], result: 'added' };

  return {
    items: items.map((current) => current.lineId === existing.lineId
      ? { ...current, ...item, lineId: current.lineId, availableStock, quantity }
      : current),
    result: 'added',
  };
}

export function increaseCartItem(items: CartItem[], lineId: string) {
  return items.map((item) => {
    if (item.lineId !== lineId) return item;
    const totalForProduct = items.filter((current) => current.productId === item.productId).reduce((total, current) => total + current.quantity, 0);
    if (item.availableStock !== undefined && totalForProduct >= item.availableStock) return item;
    return { ...item, quantity: item.quantity + 1 };
  });
}

export function decreaseCartItem(items: CartItem[], lineId: string) {
  return items.map((item) => item.lineId === lineId
    ? { ...item, quantity: Math.max(1, item.quantity - 1) }
    : item);
}

export function removeCartItem(items: CartItem[], lineId: string) {
  return items.filter((item) => item.lineId !== lineId);
}

export function serializeCart(items: CartItem[]) {
  return JSON.stringify({ version: CART_STORAGE_VERSION, items } satisfies StoredCart);
}

export function loadCartItems(storage: Pick<Storage, 'getItem'>): CartItem[] {
  const current = parseStoredCart(storage.getItem(CART_STORAGE_KEY));
  if (current) return current;
  // Migrate only structurally valid legacy arrays; malformed data is ignored.
  return parseLegacyCart(storage.getItem(LEGACY_CART_STORAGE_KEY));
}

export function persistCartItems(storage: Pick<Storage, 'setItem'>, items: CartItem[]) {
  storage.setItem(CART_STORAGE_KEY, serializeCart(items));
}

function normalizeAddItem(input: AddItemInput): CartItem | null {
  const lineId = typeof input.lineId === 'string' && isUuid(input.lineId) ? input.lineId : createLineId();
  const productId = typeof input.productId === 'string' ? input.productId.trim() : '';
  const name = typeof input.name === 'string' ? input.name.trim() : '';
  const price = Number(input.price);
  const quantity = normalizeQuantity(input.quantity ?? 1);
  const imageUrl = normalizeImageUrl(input.imageUrl);
  const availableStock = normalizeStock(input.availableStock);
  if (!productId || !name || !Number.isFinite(price) || price < 0 || quantity === null || imageUrl === undefined || availableStock === null) return null;
  return { lineId, productId, name, price, imageUrl, quantity, ...(availableStock === undefined ? {} : { availableStock }) };
}

function parseStoredCart(raw: string | null): CartItem[] | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<StoredCart>;
    if (!parsed || parsed.version !== CART_STORAGE_VERSION || !Array.isArray(parsed.items)) return null;
    return normalizeStoredItems(parsed.items);
  } catch {
    return null;
  }
}

function parseLegacyCart(raw: string | null): CartItem[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? normalizeStoredItems(parsed) : [];
  } catch {
    return [];
  }
}

function normalizeStoredItems(rawItems: unknown[]): CartItem[] {
  const byProductId = new Map<string, CartItem>();
  for (const rawItem of rawItems) {
    if (!rawItem || typeof rawItem !== 'object') continue;
    const legacy = rawItem as Partial<CartItem> & { id?: unknown };
    const productId = typeof legacy.productId === 'string' ? legacy.productId : legacy.id;
    const normalized = normalizeAddItem({
      lineId: legacy.lineId,
      productId: typeof productId === 'string' ? productId : '',
      name: legacy.name ?? '',
      price: legacy.price ?? Number.NaN,
      imageUrl: legacy.imageUrl ?? null,
      quantity: legacy.quantity,
      availableStock: legacy.availableStock,
    });
    if (!normalized || !isUuid(normalized.productId)) continue;
    const existing = byProductId.get(normalized.productId);
    const merged = existing ? addCartItem([existing], normalized).items[0] : normalized;
    if (merged) byProductId.set(normalized.productId, merged);
  }
  return [...byProductId.values()];
}

function createLineId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `00000000-0000-4000-8000-${Math.random().toString(16).slice(2, 14).padEnd(12, '0')}`;
}

function normalizeQuantity(value: unknown) {
  const quantity = Math.floor(Number(value));
  return Number.isFinite(quantity) && quantity >= 1 ? quantity : null;
}

function normalizeStock(value: unknown) {
  if (value === undefined || value === null) return undefined;
  const stock = Math.floor(Number(value));
  return Number.isFinite(stock) && stock >= 0 ? stock : null;
}

function normalizeImageUrl(value: unknown) {
  if (value === null || value === undefined || value === '') return null;
  return typeof value === 'string' ? value.trim() : undefined;
}

export function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
