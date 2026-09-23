// Sanitized response shapes returned to the admin panel. Never spreads a raw
// database row: every field is explicit, so a new column never leaks silently.

export type AdminProductRow = {
  id: string;
  name: string;
  description: string | null;
  category: string | null;
  price: number | string;
  image_url: string | null;
  is_featured: boolean;
  display_order: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export function mapAdminProductRow(row: AdminProductRow) {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? '',
    category: row.category ?? undefined,
    price: Number(row.price),
    imageUrl: row.image_url ?? '',
    featured: row.is_featured,
    sortOrder: row.display_order,
    active: row.is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export type AdminSettingsRow = { key: string; value: unknown; updated_at: string };

export function mapAdminSettingsRow(row: AdminSettingsRow) {
  return { value: row.value, updatedAt: row.updated_at };
}
