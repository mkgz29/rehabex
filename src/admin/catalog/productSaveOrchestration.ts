import type { Product, ProductInput } from '../../types/cms';

// Content, main image and visibility are saved in exactly one request, which
// admin_create_product_with_media / admin_update_product_with_media commit as
// exactly one database transaction: either everything in this call is
// persisted, or (on any error, including a 409 concurrency conflict or a
// failed activation check) none of it is. There is no second request and no
// partial-success state to represent -- unlike the interim two-request
// design this replaced, saving can only succeed or fail as a whole.
export type ProductSaveDeps = {
  createProduct: (input: Omit<ProductInput, 'id' | 'imageAssetId'>, imageAssetId: string | null) => Promise<Product>;
  updateProduct: (input: ProductInput & { id: string; expectedUpdatedAt: string }, imageAssetId: string | null) => Promise<Product>;
};

export type ProductSaveContext = { editingUpdatedAt: string | null; pendingImageAssetId: string | null };

export async function saveProduct(candidate: ProductInput, context: ProductSaveContext, deps: ProductSaveDeps): Promise<Product> {
  if (candidate.id) {
    if (!context.editingUpdatedAt) {
      throw new Error('No pudimos identificar la version actual del producto. Volve a cargar el listado.');
    }
    return deps.updateProduct({ ...candidate, id: candidate.id, expectedUpdatedAt: context.editingUpdatedAt }, context.pendingImageAssetId);
  }

  return deps.createProduct(candidate, context.pendingImageAssetId);
}

export function mergeProductIntoList(products: Product[], saved: Product, isNew: boolean): Product[] {
  return isNew ? [...products, saved] : products.map((product) => (product.id === saved.id ? saved : product));
}
