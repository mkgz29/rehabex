import { getSettingVersion, saveCatalogSectionContent, saveFeaturedSectionContent } from '../../services/adminApi';
import { AdminPageHeader } from '../components/AdminPageHeader';
import { FeaturedProductsEditor } from '../components/FeaturedProductsEditor';
import { SectionCopyEditor } from '../components/SectionCopyEditor';
import { AdminHeroPage } from './AdminHeroPage';
import { AdminAboutPage } from './AdminAboutPage';

// "Editar pagina" is the one place every editorial block of the public site
// lives (ADMIN-02D unified Hero/About; ADMIN-02E adds Productos destacados
// and Catálogo). Each block below is still its own independently-loaded,
// independently-saved form -- this page only gives them one shared route.
export function AdminEditPagePage() {
  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="Editar página"
        description="Actualizá la portada, la sección Acerca de Rehabex, los productos destacados y los títulos del catálogo. Cada bloque se guarda por separado."
      />

      <AdminHeroPage />
      <AdminAboutPage />
      <FeaturedProductsEditor />
      <SectionCopyEditor
        dirtyKey="featured-section-copy"
        heading="Textos de Productos destacados"
        description="El título y el texto que aparecen arriba de los productos destacados, en la portada de la tienda."
        titleLabel="Título de la sección"
        subtitleLabel="Descripción"
        pickContent={(landing) => landing.featuredSection}
        getVersion={() => getSettingVersion('featured_section_content')}
        save={saveFeaturedSectionContent}
        savedMessage="Textos de Productos destacados guardados correctamente."
      />
      <SectionCopyEditor
        dirtyKey="catalog-section-copy"
        heading="Textos del Catálogo Rehabex"
        description="El título y el texto del bloque que invita a ver todo el catálogo, al final de la portada."
        titleLabel="Título de la sección"
        subtitleLabel="Descripción"
        pickContent={(landing) => landing.catalogSection}
        getVersion={() => getSettingVersion('catalog_section_content')}
        save={saveCatalogSectionContent}
        savedMessage="Textos del Catálogo guardados correctamente."
      />
    </div>
  );
}
