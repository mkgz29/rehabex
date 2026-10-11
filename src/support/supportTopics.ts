// Shared between the public intake form (src/pages/SupportIntakePage.tsx) and
// the admin Soporte inbox (src/admin/support/supportPresentation.ts).
// Deliberately outside src/admin/ -- the public page must never import
// anything from there. Mirrors the closed topic set enforced server-side in
// server/support/publicValidators.ts and the support_requests_topic_check
// constraint (supabase/migrations/202610080101_admin_03b_public_support_intake.sql).

export const SUPPORT_TOPICS = ['product', 'order', 'shipping', 'payment', 'returns_warranty', 'advice', 'general', 'other'] as const;
export type SupportTopic = (typeof SUPPORT_TOPICS)[number];

export const SUPPORT_TOPIC_LABELS: Record<SupportTopic, string> = {
  product: 'Producto / información',
  order: 'Pedido',
  shipping: 'Envío / entrega',
  payment: 'Pago / facturación',
  returns_warranty: 'Cambio / devolución / garantía',
  advice: 'Asesoramiento',
  general: 'Consulta general',
  other: 'Otro',
};
