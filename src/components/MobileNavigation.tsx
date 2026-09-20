import { useEffect, useRef } from 'react';
import type { RefObject } from 'react';
import { ArrowRight, LogOut, X } from 'lucide-react';
import { Link } from 'react-router-dom';

import { navLinks } from '../content/navigation';

type MobileNavigationProps = {
  isOpen: boolean;
  activeHref: string;
  showAdminLink: boolean;
  showAuthLinks: boolean;
  showLogout: boolean;
  onClose: () => void;
  onLogout: () => void;
  triggerRef: RefObject<HTMLButtonElement>;
};

const focusableSelector = ['a[href]', 'button:not([disabled])', 'input:not([disabled])', '[tabindex]:not([tabindex="-1"])'].join(',');

export function MobileNavigation({
  isOpen,
  activeHref,
  showAdminLink,
  showAuthLinks,
  showLogout,
  onClose,
  onLogout,
  triggerRef,
}: MobileNavigationProps) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;

    const panel = panelRef.current;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    panel?.querySelector<HTMLElement>(focusableSelector)?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }

      if (event.key !== 'Tab' || !panel) return;
      const elements = Array.from(panel.querySelectorAll<HTMLElement>(focusableSelector));
      if (elements.length === 0) return;
      const first = elements[0];
      const last = elements[elements.length - 1];

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', handleKeyDown);
      triggerRef.current?.focus();
    };
  }, [isOpen, onClose, triggerRef]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-overlay md:hidden">
      <button type="button" className="absolute inset-0 bg-dark/45 backdrop-blur-[2px]" onClick={onClose} aria-label="Cerrar menú" />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="mobile-menu-title"
        className="absolute inset-y-0 left-0 flex w-[min(88vw,23rem)] flex-col bg-canvas shadow-2xl"
      >
        <div className="flex min-h-[4.5rem] items-center justify-between border-b border-line px-5">
          <p id="mobile-menu-title" className="text-sm font-bold uppercase tracking-[0.16em] text-ink">Navegación</p>
          <button type="button" onClick={onClose} className="inline-flex h-11 w-11 items-center justify-center rounded-control text-ink transition hover:bg-surface" aria-label="Cerrar menú de navegación">
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>

        <nav className="flex flex-1 flex-col overflow-y-auto px-5 py-6" aria-label="Navegación móvil">
          <div className="space-y-1">
            {navLinks.map((link) => {
              const isActive = activeHref === link.href;
              return (
                <Link
                  key={link.href}
                  to={link.href}
                  onClick={onClose}
                  aria-current={isActive ? 'page' : undefined}
                  className={`flex min-h-12 items-center justify-between rounded-control px-3 py-2.5 text-base font-semibold transition ${isActive ? 'bg-brand-soft text-brand-hover' : 'text-ink hover:bg-surface'}`}
                >
                  {link.label}
                  <ArrowRight className="h-4 w-4" aria-hidden="true" />
                </Link>
              );
            })}
          </div>

          <div className="mt-auto border-t border-line pt-5">
            {showAdminLink ? <Link to="/admin" onClick={onClose} className="flex min-h-11 items-center px-3 text-sm font-semibold text-muted">Panel administrativo</Link> : null}
            {showAuthLinks ? (
              <div className="grid grid-cols-2 gap-3 pt-2">
                <Link to="/login" onClick={onClose} className="secondary-button px-3">Ingresar</Link>
                <Link to="/registro" onClick={onClose} className="brand-button px-3">Crear cuenta</Link>
              </div>
            ) : null}
            {showLogout ? (
              <button type="button" onClick={onLogout} className="flex min-h-11 w-full items-center gap-2 px-3 text-left text-sm font-semibold text-muted transition hover:text-ink">
                <LogOut className="h-4 w-4" aria-hidden="true" />
                Cerrar sesión
              </button>
            ) : null}
          </div>
        </nav>
      </div>
    </div>
  );
}
