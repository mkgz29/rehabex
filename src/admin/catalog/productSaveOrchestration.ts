import type { Product, ProductInput } from '../../types/cms';
import { toGalleryPayload, type GalleryDraftItem, type GalleryPayloadItem } from './productGallery';

// Content, main image, gallery and visibility are saved in exactly one
// request, which admin_create_product_with_media / admin_update_product
// _with_media commit as exactly one database transaction: either everything
// in this call is persisted, or (on any error, including a 409 concurrency
// conflict or a failed activation/gallery check) none of it is. There is no
// second request and no partial-success state to represent.
export type ProductSaveDeps = {
  createProduct: (input: Omit<ProductInput, 'id' | 'imageAssetId' | 'gallery'>, gallery: GalleryPayloadItem[]) => Promise<Product>;
  updateProduct: (input: ProductInput & { id: string; expectedUpdatedAt: string }, gallery: GalleryPayloadItem[]) => Promise<Product>;
};

export type ProductSaveContext = { editingUpdatedAt: string | null; gallery: GalleryDraftItem[] };

export async function saveProduct(candidate: ProductInput, context: ProductSaveContext, deps: ProductSaveDeps): Promise<Product> {
  const galleryPayload = toGalleryPayload(context.gallery);

  if (candidate.id) {
    if (!context.editingUpdatedAt) {
      throw new Error('No pudimos identificar la version actual del producto. Volve a cargar el listado.');
    }
    return deps.updateProduct({ ...candidate, id: candidate.id, expectedUpdatedAt: context.editingUpdatedAt }, galleryPayload);
  }

  return deps.createProduct(candidate, galleryPayload);
}

export function mergeProductIntoList(products: Product[], saved: Product, isNew: boolean): Product[] {
  return isNew ? [...products, saved] : products.map((product) => (product.id === saved.id ? saved : product));
}
