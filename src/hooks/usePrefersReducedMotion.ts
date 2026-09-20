import { useEffect, useState } from 'react';

const QUERY = '(prefers-reduced-motion: reduce)';

/**
 * Reports whether the visitor asked for reduced motion, and keeps reporting it
 * if they change the setting while the page is open. Starts as `false` so the
 * markup rendered on the first pass is the one most visitors get.
 */
export function usePrefersReducedMotion() {
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;

    const query = window.matchMedia(QUERY);
    setPrefersReducedMotion(query.matches);

    const handleChange = (event: MediaQueryListEvent) => setPrefersReducedMotion(event.matches);
    query.addEventListener('change', handleChange);
    return () => query.removeEventListener('change', handleChange);
  }, []);

  return prefersReducedMotion;
}
