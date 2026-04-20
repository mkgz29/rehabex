import { NavLink, Outlet } from 'react-router-dom';

const adminLinks = [
  { label: 'Hero', to: '/admin/hero' },
  { label: 'Quienes somos', to: '/admin/quienes-somos' },
  { label: 'Productos', to: '/admin/productos' },
];

export function AdminLayout() {
  return (
    <div className="min-h-screen bg-stone-100 text-slate-900">
      <div className="mx-auto grid min-h-screen w-full max-w-7xl gap-6 px-4 py-6 lg:grid-cols-[260px_minmax(0,1fr)] lg:px-6">
        <aside className="rounded-[2rem] border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-sm font-semibold uppercase tracking-[0.24em] text-slate-500">REHABEX</p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">Panel de administracion</h1>
          <p className="mt-3 text-sm leading-6 text-slate-600">
            Edita la landing con formularios simples, visuales y sin campos tecnicos.
          </p>

          <nav className="mt-8 flex flex-col gap-2">
            {adminLinks.map((link) => (
              <NavLink
                key={link.to}
                to={link.to}
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
        </aside>

        <main className="rounded-[2rem] border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
