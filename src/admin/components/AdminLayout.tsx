import { useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';

import { useAuth } from '../../auth/useAuth';
import { UnsavedChangesProvider, useUnsavedChanges } from '../unsavedChanges/UnsavedChangesContext';
import { AdminCard } from './AdminCard';
import { AdminSecondaryButton } from './AdminButton';

export const adminLinks = [
  { label: 'Resumen', to: '/admin', end: true },
  { label: 'Editar página', to: '/admin/pagina' },
  { label: 'Productos', to: '/admin/productos' },
  { label: 'Pedidos', to: '/admin/pedidos' },
  { label: 'Soporte', to: '/admin/soporte' },
];

function AdminNav() {
  const { confirmDiscardIfDirty } = useUnsavedChanges();

  return (
    <nav
      aria-label="Secciones del panel"
      className="mt-6 flex gap-2 overflow-x-auto pb-1 lg:mt-8 lg:flex-col lg:overflow-visible lg:pb-0"
    >
      {adminLinks.map((link) => (
        <NavLink
          key={link.to}
          to={link.to}
          end={link.end}
          onClick={(event) => {
            if (!confirmDiscardIfDirty()) event.preventDefault();
          }}
          className={({ isActive }) =>
            [
              'flex min-h-11 shrink-0 items-center rounded-2xl px-4 py-3 text-sm font-medium transition lg:w-full',
              isActive ? 'bg-accent-soft text-accent' : 'text-slate-700 hover:bg-slate-100',
            ].join(' ')
          }
        >
          {link.label}
        </NavLink>
      ))}
    </nav>
  );
}

export function AdminLayout() {
  const { signOut, user } = useAuth();
  const navigate = useNavigate();
  const [logoutError, setLogoutError] = useState<string | null>(null);

  const handleLogout = async () => {
    setLogoutError(null);

    try {
      await signOut();
      navigate('/login', { replace: true });
    } catch (error) {
      setLogoutError(error instanceof Error ? error.message : 'No se pudo cerrar la sesion.');
    }
  };

  return (
    <UnsavedChangesProvider>
      <div className="min-h-screen bg-stone-100 text-slate-900">
        <div className="mx-auto grid min-h-screen w-full max-w-7xl gap-6 px-4 py-6 lg:grid-cols-[260px_minmax(0,1fr)] lg:px-6">
          <AdminCard as="aside" className="shadow-sm">
            <p className="text-sm font-semibold uppercase tracking-[0.24em] text-slate-500">REHABEX</p>
            <h1 className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">Panel de administración</h1>
            <p className="mt-3 hidden text-sm leading-6 text-slate-600 lg:block">
              Administrá tu tienda desde un solo lugar.
            </p>
            {user ? <p className="mt-4 hidden text-xs text-slate-500 lg:block">Sesión de administrador</p> : null}

            <AdminNav />

            <AdminSecondaryButton onClick={handleLogout} className="mt-8 w-full">
              Cerrar sesión
            </AdminSecondaryButton>
            {logoutError ? <p className="mt-3 text-sm text-red-600" role="alert">{logoutError}</p> : null}
          </AdminCard>

          <AdminCard as="main" className="shadow-sm">
            <Outlet />
          </AdminCard>
        </div>
      </div>
    </UnsavedChangesProvider>
  );
}
