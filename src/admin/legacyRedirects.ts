// Hero and About used to be separate screens; Ordenes used to live at
// /admin/ordenes. ADMIN-02D unified the first two into "Editar pagina" and
// renamed the third to "Pedidos". These old paths must keep working (bookmarks,
// shared links) by redirecting instead of disappearing or duplicating the screen.
export const LEGACY_ADMIN_REDIRECTS: Record<string, string> = {
  hero: '/admin/pagina',
  'quienes-somos': '/admin/pagina',
  ordenes: '/admin/pedidos',
};
