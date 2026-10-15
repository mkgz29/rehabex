import { useEffect } from 'react';
import { useLocation, useNavigationType } from 'react-router-dom';

import { ANCHOR_SCROLL_MAX_RETRIES, decideScrollAction } from '../lib/routeScroll';

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
 *
 * Anchor targets already get their sticky-header offset for free from the
 * existing global `scroll-padding-top` (src/index.css, on `html`) -- that's
 * what scrollIntoView's "start" alignment respects, so no per-component
 * scroll-margin-top or magic pixel offset is needed here.
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
      let cancelled = false;
      let frame = 0;

      const tryScroll = (attempt: number) => {
        if (cancelled) return;
        const element = document.getElementById(action.id);
        if (element) {
          element.scrollIntoView({ behavior: 'auto', block: 'start' });
          return;
        }
        // The target can be mounted by content that loads asynchronously
        // after this route itself renders (e.g. a section waiting on CMS
        // data) -- retry across a few animation frames, bounded, never an
        // infinite loop. If it never shows up, fall back to the top rather
        // than leaving the visitor wherever the previous route left off.
        if (attempt >= ANCHOR_SCROLL_MAX_RETRIES) {
          window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
          return;
        }
        frame = window.requestAnimationFrame(() => tryScroll(attempt + 1));
      };

      tryScroll(0);
      return () => {
        cancelled = true;
        window.cancelAnimationFrame(frame);
      };
    }
  }, [location.pathname, location.hash, navigationType]);

  return null;
}
