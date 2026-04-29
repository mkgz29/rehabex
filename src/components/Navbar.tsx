import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';

import { useAuth } from '../auth/useAuth';
import { useCart } from '../cart/useCart';
import logo from '../assets/logo.png';
import { navLinks } from '../content/navigation';

function NavigationLink({
  href,
  label,
  className,
  onClick,
}: {
  href: string;
  label: string;
  className: string;
  onClick?: () => void;
}) {
  if (href.startsWith('/')) {
    return (
      <Link to={href} className={className} onClick={onClick}>
        {label}
      </Link>
    );
  }

  return (
    <a href={href} className={className} onClick={onClick}>
      {label}
    </a>
  );
}

export function Navbar() {
  const [isOpen, setIsOpen] = useState(false);
  const [logoutError, setLogoutError] = useState<string | null>(null);
  const { isAdmin, loading, signOut, user } = useAuth();
  const { totalItems } = useCart();
  const location = useLocation();
  const navigate = useNavigate();
  const showAuthLinks = !loading && !user;
  const showLogout = !loading && Boolean(user);
  const showAdminLink = !loading && Boolean(user) && isAdmin;
  const cartLabel = totalItems > 0 ? `Carrito (${totalItems})` : 'Carrito';

  useEffect(() => {
    if (location.pathname === '/' && location.hash === '#contacto') {
      scrollToContact();
    }
  }, [location.hash, location.pathname]);

  function scrollToContact() {
    window.setTimeout(() => {
      document.getElementById('contacto')?.scrollIntoView({ behavior: 'smooth' });
    }, 0);
  }

  const handleContactClick = () => {
    setIsOpen(false);

    if (location.pathname === '/') {
      scrollToContact();
      return;
    }

    navigate('/#contacto');
  };

  const handleLogout = async () => {
    setLogoutError(null);
    setIsOpen(false);

    try {
      await signOut();
      navigate('/', { replace: true });
    } catch (error) {
      setLogoutError(error instanceof Error ? error.message : 'No se pudo cerrar la sesion.');
    }
  };

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
            <NavigationLink
              key={link.href}
              href={link.href}
              label={link.label}
              className="brand-nav-link text-sm font-medium text-slate-600"
            />
          ))}
          <button
            type="button"
            onClick={handleContactClick}
            className="rounded-full bg-slate-900 px-5 py-2.5 text-sm font-medium text-white transition hover:[background-color:var(--color-primary-dark)]"
          >
            Contacto
          </button>
          <Link to="/carrito" className="brand-nav-link text-sm font-medium text-slate-600">
            {cartLabel}
          </Link>
          {showAdminLink ? (
            <Link to="/admin" className="brand-nav-link text-sm font-medium text-slate-600">
              Admin
            </Link>
          ) : null}
          {showLogout ? (
            <button
              type="button"
              onClick={handleLogout}
              className="brand-nav-link text-sm font-medium text-slate-600"
            >
              Cerrar sesión
            </button>
          ) : null}
          {showAuthLinks ? (
            <>
              <Link to="/login" className="brand-nav-link text-sm font-medium text-slate-600">
                Login
              </Link>
              <Link to="/registro" className="brand-nav-link text-sm font-medium text-slate-600">
                Registrarse
              </Link>
            </>
          ) : null}
        </nav>
      </div>

      {isOpen ? (
        <nav className="border-t border-slate-200 bg-stone-50 md:hidden">
          <div className="mx-auto flex max-w-7xl flex-col gap-2 px-4 py-4 sm:px-6">
            {navLinks.map((link) => (
              <NavigationLink
                key={link.href}
                href={link.href}
                label={link.label}
                className="brand-soft-hover rounded-2xl px-4 py-3 text-sm font-medium text-slate-700"
                onClick={() => setIsOpen(false)}
              />
            ))}
            <button
              type="button"
              className="rounded-2xl bg-slate-900 px-4 py-3 text-center text-sm font-medium text-white transition hover:[background-color:var(--color-primary-dark)]"
              onClick={handleContactClick}
            >
              Contacto
            </button>
            <Link
              to="/carrito"
              className="brand-soft-hover rounded-2xl px-4 py-3 text-sm font-medium text-slate-700"
              onClick={() => setIsOpen(false)}
            >
              {cartLabel}
            </Link>
            {showAdminLink ? (
              <Link
                to="/admin"
                className="brand-soft-hover rounded-2xl px-4 py-3 text-sm font-medium text-slate-700"
                onClick={() => setIsOpen(false)}
              >
                Admin
              </Link>
            ) : null}
            {showLogout ? (
              <button
                type="button"
                onClick={handleLogout}
                className="brand-soft-hover rounded-2xl px-4 py-3 text-left text-sm font-medium text-slate-700"
              >
                Cerrar sesión
              </button>
            ) : null}
            {showAuthLinks ? (
              <>
                <Link
                  to="/login"
                  className="brand-soft-hover rounded-2xl px-4 py-3 text-sm font-medium text-slate-700"
                  onClick={() => setIsOpen(false)}
                >
                  Login
                </Link>
                <Link
                  to="/registro"
                  className="brand-soft-hover rounded-2xl px-4 py-3 text-sm font-medium text-slate-700"
                  onClick={() => setIsOpen(false)}
                >
                  Registrarse
                </Link>
              </>
            ) : null}
            {logoutError ? <p className="px-4 text-sm text-red-600">{logoutError}</p> : null}
          </div>
        </nav>
      ) : null}
      {logoutError && !isOpen ? (
        <div className="mx-auto max-w-7xl px-4 pb-3 text-sm text-red-600 sm:px-6 lg:px-8">{logoutError}</div>
      ) : null}
    </header>
  );
}
