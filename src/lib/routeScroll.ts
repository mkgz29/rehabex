// Pure decision logic for RouteScrollManager -- no DOM, no React, no
// react-router types beyond the plain strings it already passes around.
// Kept separate so the actual decision (what should happen for a given
// pathname/hash/navigation type) is unit-testable without rendering.

export type NavigationType = 'POP' | 'PUSH' | 'REPLACE';

export type ScrollAction = { kind: 'none' } | { kind: 'top' } | { kind: 'anchor'; id: string };

/**
 * - Admin routes: never touched here (Admin has its own layout/chrome).
 * - Back/forward (POP): 'none' -- the browser's own scroll restoration
 *   already handles returning to a previous history entry's position.
 * - A hash present: 'anchor' with that id, regardless of pathname -- never
 *   forces the page to the top when the visitor asked for a specific
 *   section.
 * - Otherwise (a fresh PUSH/REPLACE with no hash): 'top'.
 */
function isAdminPathname(pathname: string): boolean {
  return pathname === '/admin' || pathname.startsWith('/admin/');
}

export function decideScrollAction(pathname: string, hash: string, navigationType: NavigationType): ScrollAction {
  if (isAdminPathname(pathname)) return { kind: 'none' };
  if (navigationType === 'POP') return { kind: 'none' };
  if (hash) return { kind: 'anchor', id: hash.slice(1) };
  return { kind: 'top' };
}
