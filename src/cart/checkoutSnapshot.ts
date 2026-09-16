import type { CartItem } from './cartState';

export const CHECKOUT_SNAPSHOT_VERSION = 1;
export const CHECKOUT_SNAPSHOT_PREFIX = 'rehabex.checkout.snapshot.';
export const CHECKOUT_LOCKS_STORAGE_KEY = 'rehabex.checkout.locks.v1';

type StorageReader = Pick<Storage, 'getItem'>;
type StorageWriter = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export type CheckoutSnapshot = {
  version: typeof CHECKOUT_SNAPSHOT_VERSION;
  orderId: string;
  statusToken: string;
  createdAt: string;
  lines: Array<{ lineId: string; productId: string; quantity: number }>;
};

type CheckoutLock = Pick<CheckoutSnapshot, 'orderId' | 'createdAt'> & CheckoutSnapshot['lines'][number];

export function createCheckoutSnapshot(orderId: string, statusToken: string, items: CartItem[], createdAt = new Date().toISOString()): CheckoutSnapshot | null {
  if (!isUuid(orderId) || !/^[A-Za-z0-9_-]{43}$/.test(statusToken) || !Number.isFinite(Date.parse(createdAt))) return null;
  const lines = items
    .filter((item) => isUuid(item.lineId) && isUuid(item.productId) && Number.isInteger(item.quantity) && item.quantity > 0)
    .map((item) => ({ lineId: item.lineId, productId: item.productId, quantity: item.quantity }));
  if (lines.length === 0 || new Set(lines.map((line) => line.lineId)).size !== lines.length) return null;
  return { version: CHECKOUT_SNAPSHOT_VERSION, orderId, statusToken, createdAt, lines };
}

/** The guest token stays in sessionStorage; localStorage has only non-secret line locks. */
export function persistCheckoutSnapshot(sessionStorage: StorageWriter, localStorage: StorageWriter, snapshot: CheckoutSnapshot) {
  sessionStorage.setItem(snapshotKey(snapshot.orderId), JSON.stringify(snapshot));
  const remaining = readLocks(localStorage).filter((lock) => lock.orderId !== snapshot.orderId);
  localStorage.setItem(CHECKOUT_LOCKS_STORAGE_KEY, JSON.stringify([
    ...remaining,
    ...snapshot.lines.map((line) => ({ ...line, orderId: snapshot.orderId, createdAt: snapshot.createdAt })),
  ]));
}

export function loadCheckoutSnapshot(storage: StorageReader, orderId: string): CheckoutSnapshot | null {
  if (!isUuid(orderId)) return null;
  try {
    const value = JSON.parse(storage.getItem(snapshotKey(orderId)) ?? 'null') as Partial<CheckoutSnapshot> | null;
    if (!value || value.version !== CHECKOUT_SNAPSHOT_VERSION || value.orderId !== orderId || typeof value.statusToken !== 'string' || !Array.isArray(value.lines) || typeof value.createdAt !== 'string') return null;
    return createCheckoutSnapshot(value.orderId, value.statusToken, value.lines as CartItem[], value.createdAt);
  } catch {
    return null;
  }
}

export function releaseCheckoutSnapshot(sessionStorage: StorageWriter, localStorage: StorageWriter, orderId: string) {
  sessionStorage.removeItem(snapshotKey(orderId));
  localStorage.setItem(CHECKOUT_LOCKS_STORAGE_KEY, JSON.stringify(readLocks(localStorage).filter((lock) => lock.orderId !== orderId)));
}

export function lockedCartLineIds(storage: StorageReader) {
  return new Set(readLocks(storage).map((lock) => lock.lineId));
}

/** Removing a confirmed snapshot is idempotent and operates on line identities, not product IDs. */
export function removeConfirmedSnapshotItems(items: CartItem[], snapshot: CheckoutSnapshot): CartItem[] {
  const quantities = new Map(snapshot.lines.map((line) => [line.lineId, line.quantity]));
  return items.flatMap((item) => {
    const consumed = quantities.get(item.lineId) ?? 0;
    const quantity = item.quantity - consumed;
    return quantity > 0 ? [{ ...item, quantity }] : [];
  });
}

function snapshotKey(orderId: string) {
  return `${CHECKOUT_SNAPSHOT_PREFIX}${orderId}`;
}

function readLocks(storage: StorageReader): CheckoutLock[] {
  try {
    const value = JSON.parse(storage.getItem(CHECKOUT_LOCKS_STORAGE_KEY) ?? '[]');
    if (!Array.isArray(value)) return [];
    return value.flatMap((lock): CheckoutLock[] => {
      if (!lock || typeof lock !== 'object') return [];
      const item = lock as Partial<CheckoutLock>;
      return typeof item.orderId === 'string' && typeof item.lineId === 'string' && typeof item.productId === 'string'
        && typeof item.createdAt === 'string' && Number.isInteger(item.quantity) && (item.quantity ?? 0) > 0
        && isUuid(item.orderId) && isUuid(item.lineId) && isUuid(item.productId)
        ? [{ orderId: item.orderId, lineId: item.lineId, productId: item.productId, quantity: item.quantity!, createdAt: item.createdAt }]
        : [];
    });
  } catch {
    return [];
  }
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
