// Sanitized response shapes returned to the admin panel. Never spreads a raw
// database row: every field is explicit, so a new column never leaks silently.

export type AdminProductRow = {
  id: string;
  name: string;
  description: string | null;
  category: string | null;
  price: number | string;
  image_url: string | null;
  image_asset_id: string | null;
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
    imageAssetId: row.image_asset_id ?? undefined,
    featured: row.is_featured,
    sortOrder: row.display_order,
    active: row.is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export type AdminGalleryImageRow = { mediaAssetId: string | null; url: string; isPrimary: boolean; displayOrder: number; framing?: unknown };

export function mapAdminGalleryRow(row: AdminGalleryImageRow) {
  return { mediaAssetId: row.mediaAssetId, url: row.url, isPrimary: row.isPrimary, displayOrder: row.displayOrder, framing: row.framing ?? null };
}

export type AdminSettingsRow = { key: string; value: unknown; updated_at: string };

export function mapAdminSettingsRow(row: AdminSettingsRow) {
  return { value: row.value, updatedAt: row.updated_at };
}

export type AdminSupportRequestRow = {
  id: string;
  customer_name: string;
  customer_email: string;
  customer_phone: string | null;
  subject: string;
  message: string;
  status: 'open' | 'answered' | 'resolved';
  order_id: string | null;
  internal_notes: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
};

export function mapAdminSupportRequestRow(row: AdminSupportRequestRow) {
  return {
    id: row.id,
    customerName: row.customer_name,
    customerEmail: row.customer_email,
    customerPhone: row.customer_phone ?? undefined,
    subject: row.subject,
    message: row.message,
    status: row.status,
    orderId: row.order_id ?? undefined,
    internalNotes: row.internal_notes ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
