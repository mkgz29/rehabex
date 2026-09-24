import { ShieldCheck } from 'lucide-react';
import { useEffect, useState } from 'react';

import { usePrefersReducedMotion } from '../hooks/usePrefersReducedMotion';

/**
 * "Envíos a todo el país" is a commercial claim nobody has confirmed yet, so it
 * stays out of the rotation. Flip this to `true` once the owner confirms the
 * shipping coverage — no other change is needed.
 */
const SHIPPING_COVERAGE_CONFIRMED = false;

const announcements = [
  'Tienda oficial Rehabex',
  'Pagos disponibles con Mercado Pago',
  ...(SHIPPING_COVERAGE_CONFIRMED ? ['Envíos a todo el país'] : []),
  'Compra segura',
];

const ROTATION_MS = 5200;

export function AnnouncementBar() {
  const [index, setIndex] = useState(0);
  const prefersReducedMotion = usePrefersReducedMotion();
  const isRotating = !prefersReducedMotion && announcements.length > 1;

  useEffect(() => {
    if (!isRotating) {
      setIndex(0);
      return;
    }

    let timer = 0;

    const advance = () => setIndex((current) => (current + 1) % announcements.length);
    const start = () => {
      if (timer === 0) timer = window.setInterval(advance, ROTATION_MS);
    };
    const stop = () => {
      if (timer !== 0) {
        window.clearInterval(timer);
        timer = 0;
      }
    };

    // A background tab should not burn through the list while nobody watches.
    const handleVisibility = () => (document.hidden ? stop() : start());

    start();
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      stop();
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [isRotating]);

  return (
    <div className="bg-dark text-white">
      <div className="site-container flex min-h-8 items-center justify-center gap-2 py-1.5 text-center text-[0.6875rem] font-semibold tracking-[0.04em] sm:text-xs">
        <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-accent-soft" aria-hidden="true" />

        {/*
          Assistive technology reads one stable sentence. The rotation below is
          decoration on top of it, so nothing is re-announced every few seconds.
        */}
        <span className="sr-only">{announcements.join('. ')}.</span>

        <span className="announce-viewport" aria-hidden="true">
          {announcements.map((message, position) => (
            <span
              key={message}
              className={`announce-item ${position === index ? 'is-current' : ''}`}
            >
              {message}
            </span>
          ))}
        </span>
      </div>
    </div>
  );
}
