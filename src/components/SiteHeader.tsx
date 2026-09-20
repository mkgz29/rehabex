import { Menu, Search, ShoppingBag, UserRound } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';

import { useAuth } from '../auth/useAuth';
import logo from '../assets/logo.png';
import { useCart } from '../cart/useCart';
import { navLinks } from '../content/navigation';
import { AnnouncementBar } from './AnnouncementBar';
import { MobileNavigation } from './MobileNavigation';

function getActiveHref(pathname: string, hash: string) {
  if (pathname === '/' && hash === '#quienes-somos') return '/#quienes-somos';
  if (pathname === '/' && hash === '#contacto') return '/#contacto';
  if (pathname === '/tienda' || pathname.startsWith('/productos/')) return '/tienda';
  if (pathname === '/' && !hash) return '/';
  return '';
}

export function SiteHeader() {
  const [isOpen, setIsOpen] = useState(false);
  const [logoutError, setLogoutError] = useState<string | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const { isAdmin, loading, signOut, user } = useAuth();
  const { totalItems } = useCart();
  const location = useLocation();
  const navigate = useNavigate();
  const activeHref = getActiveHref(location.pathname, location.hash);
  const showAuthLinks = !loading && !user;
  const showLogout = !loading && Boolean(user);
  const showAdminLink = !loading && Boolean(user) && isAdmin;
  const closeMenu = useCallback(() => setIsOpen(false), []);

  useEffect(() => {
    closeMenu();
    if (location.pathname !== '/' || !location.hash) return;
    const sectionId = location.hash.slice(1);
    window.setTimeout(() => document.getElementById(sectionId)?.scrollIntoView({ behavior: 'smooth' }), 0);
  }, [closeMenu, location.hash, location.pathname]);

  const handleLogout = async () => {
    setLogoutError(null);
    closeMenu();
    try {
      await signOut();
      navigate('/', { replace: true });
    } catch (error) {
      setLogoutError(error instanceof Error ? error.message : 'No se pudo cerrar la sesión.');
    }
  };

  return (
    <>
      <a href="#contenido-principal" className="fixed left-4 top-3 z-toast -translate-y-24 rounded-control bg-dark px-4 py-3 text-sm font-bold text-white transition focus:translate-y-0">Saltar al contenido</a>
      <header className="sticky top-0 z-header border-b border-line/90 bg-canvas/95 backdrop-blur-md">
        <AnnouncementBar />
        <div className="site-container flex min-h-[4.5rem] items-center gap-3 sm:min-h-20">
          <button
            ref={triggerRef}
            type="button"
            className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-control text-ink transition hover:bg-surface md:hidden"
            onClick={() => setIsOpen(true)}
            aria-expanded={isOpen}
            aria-controls="mobile-navigation"
            aria-label="Abrir menú de navegación"
          >
            <Menu className="h-5 w-5" aria-hidden="true" />
          </button>

          <Link to="/" className="flex shrink-0 items-center" aria-label="Rehabex, ir al inicio">
            <img src={logo} alt="" width="466" height="153" className="h-9 w-auto object-contain sm:h-11" />
          </Link>

          <nav className="ml-8 hidden items-stretch self-stretch md:flex" aria-label="Navegación principal">
            {navLinks.map((link) => {
              const isActive = activeHref === link.href;
              return (
                <Link
                  key={link.href}
                  to={link.href}
                  aria-current={isActive ? 'page' : undefined}
                  className={`relative inline-flex items-center px-3 text-sm font-semibold transition lg:px-4 ${isActive ? 'text-ink' : 'text-muted hover:text-ink'}`}
                >
                  {link.label}
                  <span className={`absolute inset-x-3 bottom-0 h-0.5 bg-brand transition-transform lg:inset-x-4 ${isActive ? 'scale-x-100' : 'scale-x-0'}`} aria-hidden="true" />
                </Link>
              );
            })}
          </nav>

          <div className="ml-auto flex items-center gap-0.5 sm:gap-1">
            <Link to="/tienda" className="hidden h-11 w-11 items-center justify-center rounded-control text-ink transition hover:bg-surface sm:inline-flex" aria-label="Buscar productos en la tienda" title="Buscar productos">
              <Search className="h-[1.15rem] w-[1.15rem]" aria-hidden="true" />
            </Link>
            {showAuthLinks ? (
              <Link to="/login" className="hidden h-11 w-11 items-center justify-center rounded-control text-ink transition hover:bg-surface sm:inline-flex" aria-label="Ingresar a mi cuenta">
                <UserRound className="h-[1.15rem] w-[1.15rem]" aria-hidden="true" />
              </Link>
            ) : null}
            {showAdminLink ? <Link to="/admin" className="hidden px-2 text-sm font-semibold text-muted hover:text-ink lg:inline-flex">Admin</Link> : null}
            {showLogout ? <button type="button" onClick={handleLogout} className="hidden px-2 text-sm font-semibold text-muted hover:text-ink lg:inline-flex">Salir</button> : null}
            <Link to="/carrito" className="relative inline-flex h-11 w-11 items-center justify-center rounded-control text-ink transition hover:bg-surface" aria-label={`Carrito, ${totalItems} ${totalItems === 1 ? 'producto' : 'productos'}`}>
              <ShoppingBag className="h-5 w-5" aria-hidden="true" />
              {totalItems > 0 ? <span className="absolute right-0.5 top-0.5 flex min-h-[1.125rem] min-w-[1.125rem] items-center justify-center rounded-full bg-brand px-1 text-[0.625rem] font-bold leading-none text-white">{totalItems > 99 ? '99+' : totalItems}</span> : null}
            </Link>
          </div>
        </div>
        {logoutError ? <div role="alert" className="site-container pb-3 text-sm font-medium text-danger">{logoutError}</div> : null}
      </header>

      <div id="mobile-navigation">
        <MobileNavigation
          isOpen={isOpen}
          activeHref={activeHref}
          showAdminLink={showAdminLink}
          showAuthLinks={showAuthLinks}
          showLogout={showLogout}
          onClose={closeMenu}
          onLogout={handleLogout}
          triggerRef={triggerRef}
        />
      </div>
    </>
  );
}
