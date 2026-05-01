import { useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';

import { useAuth } from '../../auth/useAuth';

const adminLinks = [
  { label: 'Inicio', to: '/admin', end: true },
  { label: 'Hero', to: '/admin/hero' },
  { label: 'Productos', to: '/admin/productos' },
  { label: 'Ventas', to: '/admin/ordenes' },
  { label: 'Sobre Nosotros', to: '/admin/quienes-somos' },
];

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
    <div className="min-h-screen bg-stone-100 text-slate-900">
      <div className="mx-auto grid min-h-screen w-full max-w-7xl gap-6 px-4 py-6 lg:grid-cols-[260px_minmax(0,1fr)] lg:px-6">
        <aside className="rounded-[2rem] border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-sm font-semibold uppercase tracking-[0.24em] text-slate-500">REHABEX</p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">Panel de administracion</h1>
          <p className="mt-3 text-sm leading-6 text-slate-600">
            Edita la landing con formularios simples, visuales y sin campos tecnicos.
          </p>
          {user?.email ? <p className="mt-4 text-xs text-slate-500">{user.email}</p> : null}

          <nav className="mt-8 flex flex-col gap-2">
            {adminLinks.map((link) => (
              <NavLink
                key={link.to}
                to={link.to}
                end={link.end}
                className={({ isActive }) =>
                  [
                    'rounded-2xl px-4 py-3 text-sm font-medium transition',
                    isActive ? 'brand-accent-soft brand-accent-text' : 'text-slate-700 hover:bg-slate-100',
                  ].join(' ')
                }
              >
                {link.label}
              </NavLink>
            ))}
          </nav>

          <button
            type="button"
            onClick={handleLogout}
            className="mt-8 inline-flex w-full items-center justify-center rounded-full border border-slate-300 px-4 py-3 text-sm font-semibold text-slate-700 transition hover:border-slate-900 hover:bg-slate-50"
          >
            Cerrar sesion
          </button>
          {logoutError ? <p className="mt-3 text-sm text-red-600">{logoutError}</p> : null}
        </aside>

        <main className="rounded-[2rem] border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
