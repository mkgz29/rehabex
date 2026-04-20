import { useState } from 'react';
import { Link } from 'react-router-dom';

import logo from '../assets/logo.png';
import { navLinks } from '../content/navigation';

export function Navbar() {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <header className="sticky top-0 z-50 border-b border-slate-200/70 bg-stone-50/95 backdrop-blur">
      <div className="mx-auto flex min-h-[72px] w-full max-w-7xl items-center justify-between px-4 py-3 sm:px-6 lg:px-8">
        <a href="/" className="flex shrink-0 items-center">
          <img src={logo} alt="Rehabex logo" className="h-12 w-auto object-contain sm:h-14" />
        </a>

        <button
          type="button"
          className={`brand-menu-button md:hidden ${isOpen ? 'active' : ''}`}
          onClick={() => setIsOpen((current) => !current)}
          aria-expanded={isOpen}
          aria-label={isOpen ? 'Cerrar menu de navegacion' : 'Abrir menu de navegacion'}
        >
          <span className="sr-only">{isOpen ? 'Cerrar menu' : 'Abrir menu'}</span>
          <span className="brand-menu-button__line" aria-hidden="true" />
          <span className="brand-menu-button__line" aria-hidden="true" />
          <span className="brand-menu-button__line" aria-hidden="true" />
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
          <Link to="/admin" className="brand-nav-link text-sm font-medium text-slate-600">
            Admin
          </Link>
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
            <Link
              to="/admin"
              className="brand-soft-hover rounded-2xl px-4 py-3 text-sm font-medium text-slate-700"
              onClick={() => setIsOpen(false)}
            >
              Admin
            </Link>
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
