import { useEffect } from 'react';
import { useLocation, useNavigationType } from 'react-router-dom';

import { decideScrollAction } from '../lib/routeScroll';

/**
 * Fixes the real bug: clicking a Navbar link (Tienda, Soporte, Inicio, a
 * product) changed the route but the browser kept the previous scroll
 * position, landing the visitor mid-page or near the footer of whatever
 * came up next.
 *
 * Mounted once in AppLayout -- never per-page -- so no page has to call
 * window.scrollTo itself. The actual decision (top / anchor / do nothing)
 * is decideScrollAction, a pure function in src/lib/routeScroll.ts; this
 * component only ever applies it to the real DOM/window.
 */
export function RouteScrollManager() {
  const location = useLocation();
  const navigationType = useNavigationType();

  useEffect(() => {
    const action = decideScrollAction(location.pathname, location.hash, navigationType);

    if (action.kind === 'top') {
      window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
      return;
    }

    if (action.kind === 'anchor') {
      const timer = window.setTimeout(() => {
        document.getElementById(action.id)?.scrollIntoView({ behavior: 'smooth' });
      }, 0);
      return () => window.clearTimeout(timer);
    }
  }, [location.pathname, location.hash, navigationType]);

  return null;
}
