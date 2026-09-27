import { AdminPageHeader } from '../components/AdminPageHeader';
import { AdminHeroPage } from './AdminHeroPage';
import { AdminAboutPage } from './AdminAboutPage';

// "Editar pagina" replaces the old, separate Hero and About screens (ADMIN-02D).
// Each block below is still its own independently-loaded, independently-saved
// form -- this page only gives them one shared route and a single place to land.
export function AdminEditPagePage() {
  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="Editar página"
        description="Actualizá la portada principal y la sección Acerca de Rehabex. Cada bloque se guarda por separado."
      />

      <AdminHeroPage />
      <AdminAboutPage />
    </div>
  );
}
