import { Outlet, useLocation } from 'react-router-dom';

import { FloatingWhatsAppButton } from './FloatingWhatsAppButton';
import { Navbar } from './Navbar';
import { RouteScrollManager } from './RouteScrollManager';

/** Sign-in pages are a self-contained full-screen composition: no site header or floating chat over the form. */
const IMMERSIVE_PATHS = new Set(['/login', '/registro']);

export function AppLayout() {
  const { pathname } = useLocation();
  const immersive = IMMERSIVE_PATHS.has(pathname);

  return (
    <>
      <RouteScrollManager />
      {immersive ? null : <Navbar />}
      <Outlet />
      {immersive ? null : <FloatingWhatsAppButton />}
    </>
  );
}
