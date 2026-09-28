// Client-side pre-validation for the product form, mirroring the limits
// already enforced server-side in server/admin/validators.ts. Catching these
// before the network round-trip is what lets the form point at the exact
// field that needs fixing ("Ingresá el nombre del producto.") instead of a
// generic "Solicitud invalida." from the server.
export type ProductFormValues = {
  name: string;
  description: string;
  category: string;
  price: number | '';
};

export const PRODUCT_FIELD_ORDER = ['name', 'description', 'price', 'category'] as const;
export type ProductFormField = (typeof PRODUCT_FIELD_ORDER)[number];
export type ProductFormErrors = Partial<Record<ProductFormField, string>>;

const MAX_NAME = 160;
const MAX_DESCRIPTION = 4000;
const MAX_CATEGORY = 80;
const MAX_PRICE = 100_000_000;

const RESERVED_CATEGORIES = new Set(['test', 'prueba']);

export function isReservedCategoryName(category: string): boolean {
  return RESERVED_CATEGORIES.has(category.trim().toLowerCase());
}

export function validateProductForm(values: ProductFormValues): ProductFormErrors {
  const errors: ProductFormErrors = {};

  const name = values.name.trim();
  if (!name) {
    errors.name = 'Ingresá el nombre del producto.';
  } else if (name.length > MAX_NAME) {
    errors.name = `El nombre es muy largo (máximo ${MAX_NAME} caracteres).`;
  }

  if (values.description.trim().length > MAX_DESCRIPTION) {
    errors.description = `La descripción es muy larga (máximo ${MAX_DESCRIPTION} caracteres).`;
  }

  if (values.price === '' || typeof values.price !== 'number' || !Number.isFinite(values.price) || values.price <= 0) {
    errors.price = 'Ingresá un precio válido.';
  } else if (values.price > MAX_PRICE) {
    errors.price = 'Ese precio es demasiado alto.';
  }

  const category = values.category.trim();
  if (!category) {
    errors.category = 'Elegí una categoría o escribí una nueva.';
  } else if (category.length > MAX_CATEGORY) {
    errors.category = `La categoría es muy larga (máximo ${MAX_CATEGORY} caracteres).`;
  } else if (isReservedCategoryName(category)) {
    errors.category = 'Ese nombre de categoría no está permitido. Elegí otro.';
  }

  return errors;
}

export function firstErrorField(errors: ProductFormErrors): ProductFormField | null {
  for (const field of PRODUCT_FIELD_ORDER) {
    if (errors[field]) return field;
  }
  return null;
}
