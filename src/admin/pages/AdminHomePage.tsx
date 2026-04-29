import { AdminPageHeader } from '../components/AdminPageHeader';

export function AdminHomePage() {
  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="Inicio"
        description="Accede a las secciones editables del panel de administracion."
      />

      <section className="rounded-[2rem] border border-slate-200 bg-stone-50 p-5">
        <h3 className="text-lg font-semibold text-slate-900">Secciones disponibles</h3>
        <p className="mt-3 text-sm leading-6 text-slate-600">
          Usa la navegacion del panel para actualizar el Hero, los productos y la seccion Sobre Nosotros.
        </p>
      </section>
    </div>
  );
}
