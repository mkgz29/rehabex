import { Outlet } from 'react-router-dom';

import { FloatingWhatsAppButton } from './FloatingWhatsAppButton';
import { Navbar } from './Navbar';

export function AppLayout() {
  return (
    <>
      <Navbar />
      <Outlet />
      <FloatingWhatsAppButton />
    </>
  );
}
