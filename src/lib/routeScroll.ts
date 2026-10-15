// Pure decision logic for RouteScrollManager -- no DOM, no React, no
// react-router types beyond the plain strings it already passes around.
// Kept separate so the actual decision (what should happen for a given
// pathname/hash/navigation type) is unit-testable without rendering.

export type NavigationType = 'POP' | 'PUSH' | 'REPLACE';

export type ScrollAction = { kind: 'none' } | { kind: 'top' } | { kind: 'anchor'; id: string };

function isAdminPathname(pathname: string): boolean {
  return pathname === '/admin' || pathname.startsWith('/admin/');
}

/**
 * - Admin routes: never touched here (Admin has its own layout/chrome, even
 *   though it happens to be nested under AppLayout's same Outlet).
 * - Back/forward (POP): 'none' -- the browser's own scroll restoration
 *   already handles returning to a previous history entry's position;
 *   forcing scroll here would override that.
 * - A hash present: 'anchor' with that id, regardless of pathname -- covers
 *   both "navigate to a new route with a hash" and "same route, hash
 *   changes" (e.g. "/" -> "/#productos") identically, since both are just
 *   "hash is now present/different".
 * - Otherwise (a fresh PUSH/REPLACE with no hash): 'top'.
 */
export function decideScrollAction(pathname: string, hash: string, navigationType: NavigationType): ScrollAction {
  if (isAdminPathname(pathname)) return { kind: 'none' };
  if (navigationType === 'POP') return { kind: 'none' };
  if (hash) return { kind: 'anchor', id: hash.slice(1) };
  return { kind: 'top' };
}

/**
 * Bounded retry budget for "the anchor's element isn't in the DOM yet"
 * (content that loads asynchronously after the route itself renders). One
 * requestAnimationFrame per attempt, so this is at most a few hundred ms at
 * 60fps -- never an infinite loop, and never a fixed setTimeout guess.
 */
export const ANCHOR_SCROLL_MAX_RETRIES = 20;

