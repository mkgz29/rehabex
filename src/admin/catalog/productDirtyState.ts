import type { ProductInput } from '../../types/cms';

/** Plain structural comparison: the product form's shape is flat enough
 * (no nested objects besides itself) that JSON comparison is exact and
 * order-stable, since both sides are built from the same object shape. */
export function isProductFormDirty(current: ProductInput, initial: ProductInput): boolean {
  return JSON.stringify(current) !== JSON.stringify(initial);
}
