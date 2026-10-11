// Local source of admin implementation notices (FASE 7D.2). Deliberately a
// plain data module, not baked into the component that renders it: the
// future Super Admin can replace this file's export with a fetch from its
// own API without ever touching AdminImplementationNoticeCard or whatever
// renders the list.

export type AdminImplementationNotice = {
  id: string;
  title: string;
  message: string;
  /** ISO date string. Never shown to the admin -- only used to compute
   * whether the notice is still within its visibility window. */
  publishedAt: string;
};

export const NOTICE_VISIBILITY_DAYS = 21;

/** A notice is active for NOTICE_VISIBILITY_DAYS after publishedAt, then
 * disappears on its own -- no expiresAt/publishedAt is ever shown to the
 * admin, this is purely an internal cutoff. `now` is injectable so callers
 * (and tests) never depend on the real wall clock. */
export function isNoticeActive(notice: AdminImplementationNotice, now: Date = new Date()): boolean {
  const published = new Date(notice.publishedAt);
  const expiresAt = new Date(published.getTime() + NOTICE_VISIBILITY_DAYS * 24 * 60 * 60 * 1000);
  return now.getTime() < expiresAt.getTime();
}

/** The notices to actually render: still active, most recent first, capped
 * so the Resumen page never gets crowded by several at once. */
export function activeAdminImplementationNotices(
  notices: AdminImplementationNotice[],
  now: Date = new Date(),
  max = 3,
): AdminImplementationNotice[] {
  return notices
    .filter((notice) => isNoticeActive(notice, now))
    .sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime())
    .slice(0, max);
}

export const ADMIN_IMPLEMENTATION_NOTICES: AdminImplementationNotice[] = [
  {
    id: 'admin-support-center-2026-10',
    title: 'Nuevo Centro de Soporte',
    message: 'Ahora podés recibir consultas desde la web y contactar a tus clientes por WhatsApp y Gmail.',
    publishedAt: '2026-10-11T00:00:00.000Z',
  },
];
