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
  stock_on_hand: number;
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
    stockOnHand: Number(row.stock_on_hand),
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
  subject: string | null;
  message: string;
  status: 'open' | 'answered' | 'resolved' | 'archived';
  order_id: string | null;
  /** Free text from the public intake form (ADMIN-03B); never resolved against orders. */
  order_reference: string | null;
  /** 'admin' for a staff-logged ticket, 'web' for one submitted through /soporte (ADMIN-03B). */
  source: 'admin' | 'web';
  topic: 'product' | 'order' | 'shipping' | 'payment' | 'returns_warranty' | 'advice' | 'general' | 'other';
  internal_notes: string | null;
  /** Nullable since ADMIN-03B: a web-origin ticket has no admin actor to attribute. */
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export function mapAdminSupportRequestRow(row: AdminSupportRequestRow) {
  return {
    id: row.id,
    customerName: row.customer_name,
    customerEmail: row.customer_email,
    customerPhone: row.customer_phone ?? undefined,
    subject: row.subject ?? undefined,
    message: row.message,
    status: row.status,
    orderId: row.order_id ?? undefined,
    orderReference: row.order_reference ?? undefined,
    source: row.source,
    topic: row.topic,
    internalNotes: row.internal_notes ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
