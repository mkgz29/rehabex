import { Outlet } from 'react-router-dom';

import { FloatingWhatsAppButton } from './FloatingWhatsAppButton';
import { Navbar } from './Navbar';
import { RouteScrollManager } from './RouteScrollManager';

export function AppLayout() {
  return (
    <>
      <RouteScrollManager />
      <Navbar />
      <Outlet />
      <FloatingWhatsAppButton />
    </>
  );
}
