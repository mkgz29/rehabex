import assert from 'node:assert/strict';
import test from 'node:test';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { buildCategoryDirectory, normalizeCategoryKey, resolveCategoryInput } from '../../src/admin/catalog/categoryOptions.ts';
import { isProductFormDirty } from '../../src/admin/catalog/productDirtyState.ts';
import { filterProducts } from '../../src/admin/catalog/productListFilters.ts';
import { firstErrorField, isReservedCategoryName, validateProductForm } from '../../src/admin/catalog/productFormValidation.ts';
import { AdminProductsPage } from '../../src/admin/pages/AdminProductsPage.tsx';
import { UnsavedChangesProvider } from '../../src/admin/unsavedChanges/UnsavedChangesContext.tsx';
import type { ProductInput } from '../../src/types/cms.ts';

(globalThis as typeof globalThis & { React: typeof React }).React = React;

// --- Category normalization --------------------------------------------------

test('normalizeCategoryKey trims and lowercases for comparison only', () => {
  assert.equal(normalizeCategoryKey('  Ortopedia '), 'ortopedia');
  assert.equal(normalizeCategoryKey('ORTOPEDIA'), 'ortopedia');
});

test('buildCategoryDirectory keeps the first-seen spelling per normalized key, ignores blanks', () => {
  const directory = buildCategoryDirectory(['Ortopedia', 'ortopedia', ' ORTOPEDIA ', 'Movilidad', undefined, '', '  ']);
  assert.equal(directory.size, 2);
  assert.equal(directory.get('ortopedia'), 'Ortopedia');
  assert.equal(directory.get('movilidad'), 'Movilidad');
});

test('resolveCategoryInput snaps a case/space variant onto the existing category instead of creating a near-duplicate', () => {
  const directory = buildCategoryDirectory(['Ortopedia']);
  assert.equal(resolveCategoryInput('ortopedia', directory), 'Ortopedia');
  assert.equal(resolveCategoryInput('  ORTOPEDIA  ', directory), 'Ortopedia');
  assert.equal(resolveCategoryInput('Movilidad', directory), 'Movilidad');
  assert.equal(resolveCategoryInput('  Bienestar  ', directory), 'Bienestar');
});

// --- Product form validation --------------------------------------------------

test('validateProductForm requires a name, a valid category and a positive price', () => {
  const errors = validateProductForm({ name: '', description: '', category: '', price: '' });
  assert.equal(errors.name, 'Ingresá el nombre del producto.');
  assert.equal(errors.category, 'Elegí una categoría o escribí una nueva.');
  assert.equal(errors.price, 'Ingresá un precio válido.');
});

test('validateProductForm accepts a fully valid product with no errors', () => {
  const errors = validateProductForm({ name: 'Rodillera', description: 'Soporte para rodilla', category: 'Ortopedia', price: 15000 });
  assert.deepEqual(errors, {});
});

test('validateProductForm rejects a reserved category name for the client, same words the server blocks', () => {
  assert.equal(isReservedCategoryName('TEST'), true);
  assert.equal(isReservedCategoryName(' prueba '), true);
  assert.equal(isReservedCategoryName('Ortopedia'), false);
  const errors = validateProductForm({ name: 'x', description: '', category: 'Prueba', price: 10 });
  assert.equal(errors.category, 'Ese nombre de categoría no está permitido. Elegí otro.');
});

test('validateProductForm rejects a zero or negative price without accepting it as valid', () => {
  assert.ok(validateProductForm({ name: 'x', description: '', category: 'Ortopedia', price: 0 }).price);
  assert.ok(validateProductForm({ name: 'x', description: '', category: 'Ortopedia', price: -5 }).price);
});

test('firstErrorField returns fields in the same top-to-bottom order as the form', () => {
  assert.equal(firstErrorField({ price: 'x', category: 'y' }), 'price');
  assert.equal(firstErrorField({ category: 'y' }), 'category');
  assert.equal(firstErrorField({}), null);
});

// --- List filters --------------------------------------------------------------

const sample = [
  { name: 'Rodillera deportiva', category: 'Ortopedia', active: true },
  { name: 'Bastón plegable', category: 'Movilidad', active: false },
  { name: 'Faja lumbar', category: 'Ortopedia', active: false },
];

test('filterProducts matches by name search, case-insensitively', () => {
  assert.deepEqual(
    filterProducts(sample, { query: 'rodillera', visibility: 'all', category: '' }).map((p) => p.name),
    ['Rodillera deportiva'],
  );
});

test('filterProducts matches by visibility', () => {
  assert.deepEqual(
    filterProducts(sample, { query: '', visibility: 'visible', category: '' }).map((p) => p.name),
    ['Rodillera deportiva'],
  );
  assert.deepEqual(
    filterProducts(sample, { query: '', visibility: 'hidden', category: '' }).map((p) => p.name),
    ['Bastón plegable', 'Faja lumbar'],
  );
});

test('filterProducts matches by category, ignoring case', () => {
  assert.deepEqual(
    filterProducts(sample, { query: '', visibility: 'all', category: 'ortopedia' }).map((p) => p.name),
    ['Rodillera deportiva', 'Faja lumbar'],
  );
});

test('filterProducts combines all three filters', () => {
  assert.deepEqual(
    filterProducts(sample, { query: 'faja', visibility: 'hidden', category: 'Ortopedia' }).map((p) => p.name),
    ['Faja lumbar'],
  );
  assert.deepEqual(filterProducts(sample, { query: 'faja', visibility: 'visible', category: 'Ortopedia' }), []);
});

// --- Dirty-state detection ------------------------------------------------------

const baseProduct: ProductInput = {
  name: 'Rodillera',
  description: '',
  price: 15000,
  imageUrl: '',
  category: 'Ortopedia',
  featured: false,
  sortOrder: 0,
  active: true,
};

test('isProductFormDirty is false when nothing changed', () => {
  assert.equal(isProductFormDirty(baseProduct, { ...baseProduct }), false);
});

test('isProductFormDirty is true for any field difference, including visibility', () => {
  assert.equal(isProductFormDirty({ ...baseProduct, name: 'Rodillera XL' }, baseProduct), true);
  assert.equal(isProductFormDirty({ ...baseProduct, active: false }, baseProduct), true);
});

// --- Rendered page: initial state (list closed form, still "loading") ----------
//
// useEffect never runs during static server rendering, so this captures the
// page exactly as a user sees it for the first instant: isFormOpen=false,
// productsLoading=true (the useState initial values). That is enough to prove
// the loading state has no forbidden technical vocabulary in what is actually
// rendered, not just in the source file (which legitimately references
// Supabase/Cloudinary in imports, identifiers and comments that are never
// shown to a user).

function renderInitialProductsPage() {
  return renderToStaticMarkup(React.createElement(UnsavedChangesProvider, null, React.createElement(AdminProductsPage)));
}

test('AdminProductsPage: initial render shows the loading state, not the form, with no forbidden vocabulary', () => {
  const markup = renderInitialProductsPage();
  assert.match(markup, /Agregar producto/);
  assert.match(markup, /aria-busy="true"/);
  assert.doesNotMatch(markup, /Nuevo producto|Editar producto/);

  const forbidden = ['CTA', 'pipeline', 'slug', 'asset', 'endpoint', 'RPC', 'payload', 'UUID', 'Cloudinary', 'Supabase', 'webhook', 'expectedUpdatedAt', 'is_active'];
  for (const word of forbidden) {
    assert.doesNotMatch(markup, new RegExp(`\\b${word}\\b`, 'i'), `found forbidden term "${word}" in the rendered products page`);
  }
});

test('AdminProductsPage: search, status and category filters render as plain, labeled controls', () => {
  const markup = renderInitialProductsPage();
  assert.match(markup, /Buscar por nombre/);
  assert.match(markup, /Visibles/);
  assert.match(markup, /Ocultos/);
  assert.match(markup, /Todas las categorias/);
});
