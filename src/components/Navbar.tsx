import { useState } from 'react';

import { navLinks } from '../data/landing';

export function Navbar() {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <header className="sticky top-0 z-50 border-b border-slate-200/70 bg-stone-50/95 backdrop-blur">
      <div className="mx-auto flex w-full max-w-7xl items-center justify-between px-4 py-4 sm:px-6 lg:px-8">
        <a href="#" className="flex items-center gap-3">
          <span className="brand-button flex h-10 w-10 items-center justify-center rounded-full text-sm font-bold">
            RX
          </span>
          <div>
            <p className="text-lg font-semibold tracking-[0.16em] text-slate-900">REHABEX</p>
            <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Rehabilitacion inteligente</p>
          </div>
        </a>

        <button
          type="button"
          className="brand-ring-button inline-flex items-center justify-center rounded-full border border-slate-300 p-2 text-slate-700 md:hidden"
          onClick={() => setIsOpen((current) => !current)}
          aria-expanded={isOpen}
          aria-label="Abrir menu de navegacion"
        >
          <span className="sr-only">Abrir menu</span>
          <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.8">
            <path strokeLinecap="round" d={isOpen ? 'M6 6l12 12M18 6L6 18' : 'M4 7h16M4 12h16M4 17h16'} />
          </svg>
        </button>

        <nav className="hidden items-center gap-8 md:flex">
          {navLinks.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="brand-nav-link text-sm font-medium text-slate-600"
            >
              {link.label}
            </a>
          ))}
          <a
            href="#contacto"
            className="rounded-full bg-slate-900 px-5 py-2.5 text-sm font-medium text-white transition hover:[background-color:var(--color-primary-dark)]"
          >
            Contacto
          </a>
        </nav>
      </div>

      {isOpen ? (
        <nav className="border-t border-slate-200 bg-stone-50 md:hidden">
          <div className="mx-auto flex max-w-7xl flex-col gap-2 px-4 py-4 sm:px-6">
            {navLinks.map((link) => (
              <a
                key={link.href}
                href={link.href}
                className="brand-soft-hover rounded-2xl px-4 py-3 text-sm font-medium text-slate-700"
                onClick={() => setIsOpen(false)}
              >
                {link.label}
              </a>
            ))}
            <a
              href="#contacto"
              className="rounded-2xl bg-slate-900 px-4 py-3 text-center text-sm font-medium text-white transition hover:[background-color:var(--color-primary-dark)]"
              onClick={() => setIsOpen(false)}
            >
              Contacto
            </a>
          </div>
        </nav>
      ) : null}
    </header>
  );
}
