import { ArrowRight, LogOut, Search, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { FormEvent, RefObject } from 'react';
import { Link, useNavigate } from 'react-router-dom';

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
  const [searchQuery, setSearchQuery] = useState('');
  const navigate = useNavigate();

  const handleSearch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const query = searchQuery.trim();
    navigate(query ? `/tienda?buscar=${encodeURIComponent(query)}` : '/tienda');
    onClose();
  };

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
      <button type="button" tabIndex={-1} className="absolute inset-0 bg-dark/45 backdrop-blur-[2px]" onClick={onClose} aria-label="Cerrar menú" />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="mobile-menu-title"
        className="absolute inset-y-0 left-0 flex w-[min(90vw,23rem)] flex-col border-r border-line bg-canvas shadow-lift"
      >
        <div className="flex min-h-20 items-center justify-between border-b border-line px-5">
          <div>
            <p id="mobile-menu-title" className="text-sm font-bold uppercase tracking-[0.16em] text-ink">Rehabex</p>
            <p className="mt-1 text-xs text-muted">Navegación y catálogo</p>
          </div>
          <button type="button" onClick={onClose} className="inline-flex h-11 w-11 items-center justify-center rounded-control text-ink transition hover:bg-surface" aria-label="Cerrar menú de navegación">
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>

        <nav className="flex flex-1 flex-col overflow-y-auto px-5 py-6" aria-label="Navegación móvil">
          <form role="search" onSubmit={handleSearch} className="mb-6 border-b border-line pb-6">
            <label htmlFor="mobile-site-search" className="text-xs font-bold uppercase tracking-[0.16em] text-muted">Buscar productos</label>
            <div className="mt-3 flex gap-2">
              <input
                id="mobile-site-search"
                type="search"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="Ej. camilla"
                className="min-h-11 min-w-0 flex-1 rounded-control border border-line bg-surface px-3 text-sm text-ink outline-none placeholder:text-muted focus:border-accent"
              />
              <button type="submit" className="brand-button w-11 shrink-0 px-0" aria-label="Buscar en el catálogo">
                <Search className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
          </form>

          <div className="space-y-1">
            {navLinks.map((link) => {
              const isActive = activeHref === link.href;
              return (
                <Link
                  key={link.href}
                  to={link.href}
                  onClick={onClose}
                  aria-current={isActive ? 'page' : undefined}
                  className={`flex min-h-12 items-center justify-between rounded-control px-3 py-2.5 text-base font-semibold transition ${isActive ? 'bg-brand/5 text-primary ring-1 ring-inset ring-brand/15' : 'text-ink hover:bg-surface'}`}
                >
                  {link.label}
                  <ArrowRight className={`h-4 w-4 ${isActive ? 'text-brand' : ''}`} aria-hidden="true" />
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
