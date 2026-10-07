import { useCallback, useEffect, useMemo, useState } from 'react';
import { Gauge, Image, LayoutGrid, Star, Users } from 'lucide-react';

import { FramedImage } from '../../components/media/FramedImage';
import { defaultLandingContent } from '../../lib/defaultContent';
import { getSettingVersion, saveCatalogSectionContent, saveFeaturedSectionContent } from '../../services/adminApi';
import { getLandingContent, getProducts } from '../../services/cms';
import type { LandingContent, Product } from '../../types/cms';
import { AdminPageHeader } from '../components/AdminPageHeader';
import { EditableSectionCard } from '../components/EditableSectionCard';
import { FeaturedProductsEditor, isReservedFeaturedCategory } from '../components/FeaturedProductsEditor';
import { SectionCopyEditor } from '../components/SectionCopyEditor';
import { useUnsavedChanges } from '../unsavedChanges/UnsavedChangesContext';
import { AdminAboutPage } from './AdminAboutPage';
import { AdminHeroPage } from './AdminHeroPage';

export type SectionId = 'hero' | 'featured' | 'about' | 'metrics' | 'catalog';
type FeaturedView = 'products' | 'copy';

export function nextOpenSection(current: SectionId | null, requested: SectionId, canLeaveCurrent: boolean): SectionId | null {
  if (!canLeaveCurrent) return current;
  return current === requested ? null : requested;
}

function SummaryImage({ url, alt, framing }: { url: string; alt: string; framing?: LandingContent['hero']['image_framing'] }) {
  return url ? (
    <div className="h-16 w-16 shrink-0 overflow-hidden rounded-xl border border-slate-200 bg-slate-100">
      <FramedImage media={{ kind: 'image', url, framing }} alt={alt} className="h-full w-full" />
    </div>
  ) : (
    <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-xl border border-dashed border-slate-300 bg-white px-1 text-center text-[10px] leading-3 text-slate-500">Sin imagen</div>
  );
}

function destinationLabel(link: string): string {
  if (link === '#productos') return 'Productos destacados';
  if (link === '/tienda') return 'Tienda';
  return link || 'Sin destino';
}

function firstLine(value: string): string {
  return value.split(/\r?\n/, 1)[0] || 'Sin descripción';
}

export function AdminEditPagePage() {
  const [openSection, setOpenSection] = useState<SectionId | null>(null);
  const [featuredView, setFeaturedView] = useState<FeaturedView>('products');
  const [landing, setLanding] = useState<LandingContent>(defaultLandingContent);
  const [products, setProducts] = useState<Product[] | null>(null);
  const [confirmations, setConfirmations] = useState<Partial<Record<SectionId, string>>>({});
  const { confirmDiscardIfDirty } = useUnsavedChanges();

  const refreshLanding = useCallback(async () => {
    try {
      setLanding(await getLandingContent());
    } catch {
      // The closed summaries keep the last known content if refresh fails.
    }
  }, []);

  const refreshProducts = useCallback(async () => {
    try {
      setProducts(await getProducts());
    } catch {
      setProducts((current) => current ?? []);
    }
  }, []);

  useEffect(() => {
    void refreshLanding();
    void refreshProducts();
  }, [refreshLanding, refreshProducts]);

  const featuredProducts = useMemo(
    () => (products ?? [])
      .filter((product) => product.featured && !isReservedFeaturedCategory(product.category ?? ''))
      .sort((a, b) => a.sortOrder - b.sortOrder),
    [products],
  );

  const toggleSection = (section: SectionId) => {
    const next = nextOpenSection(openSection, section, confirmDiscardIfDirty());
    if (next === openSection) return;
    if (next === 'featured') setFeaturedView('products');
    setConfirmations((current) => ({ ...current, [section]: undefined }));
    setOpenSection(next);
  };

  const finishSection = (section: SectionId, message: string, refresh: () => Promise<void>) => {
    setConfirmations((current) => ({ ...current, [section]: message }));
    setOpenSection(null);
    void refresh();
  };

  const closeSection = () => setOpenSection(null);

  const switchFeaturedView = (next: FeaturedView) => {
    if (next === featuredView) return;
    if (confirmDiscardIfDirty()) setFeaturedView(next);
  };

  return (
    <div className="space-y-6">
      <AdminPageHeader title="Editar página" description="Actualizá lo que las personas ven en la portada de la tienda." />

      <div className="space-y-4">
        <EditableSectionCard
          id="hero-section"
          title="Portada principal"
          description="La primera imagen y mensaje que ve quien entra a la tienda."
          icon={Image}
          isOpen={openSection === 'hero'}
          confirmation={confirmations.hero}
          onToggle={() => toggleSection('hero')}
          summary={(
            <div className="flex items-center gap-3">
              <SummaryImage url={landing.hero.image_url} framing={landing.hero.image_framing} alt="Vista previa de la portada" />
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-slate-900">{landing.hero.title || 'Sin título'}</p>
                <p className="mt-1 text-xs text-slate-500">Botón: {destinationLabel(landing.hero.primary_cta_link)}</p>
              </div>
            </div>
          )}
        >
          <AdminHeroPage onCancel={closeSection} onSaved={(message) => finishSection('hero', message, refreshLanding)} />
        </EditableSectionCard>

        <EditableSectionCard
          id="featured-section"
          title="Productos destacados"
          description="Elegí qué productos aparecen primero y ajustá el texto que los acompaña."
          icon={Star}
          isOpen={openSection === 'featured'}
          confirmation={confirmations.featured}
          onToggle={() => toggleSection('featured')}
          summary={(
            <div className="flex items-center gap-3">
              <div className="flex -space-x-2" aria-label="Primeros productos seleccionados">
                {featuredProducts.slice(0, 3).map((product) => product.imageUrl ? (
                  <img key={product.id} src={product.imageUrl} alt="" className="h-12 w-12 rounded-xl border-2 border-stone-50 object-cover object-center" />
                ) : (
                  <div key={product.id} className="flex h-12 w-12 items-center justify-center rounded-xl border-2 border-stone-50 bg-slate-100 px-1 text-center text-[9px] leading-3 text-slate-500">Sin imagen</div>
                ))}
                {featuredProducts.length === 0 ? <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-dashed border-slate-300 bg-white text-[10px] text-slate-500">0</div> : null}
              </div>
              <p className="text-sm font-medium text-slate-700">{featuredProducts.length} {featuredProducts.length === 1 ? 'producto seleccionado' : 'productos seleccionados'}</p>
            </div>
          )}
        >
          <div className="mb-5 flex flex-wrap gap-2 border-b border-slate-200 pb-4" aria-label="Qué querés editar">
            <button type="button" aria-pressed={featuredView === 'products'} onClick={() => switchFeaturedView('products')} className={`min-h-11 rounded-full border px-4 py-2 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] ${featuredView === 'products' ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-300 bg-white text-slate-700 hover:border-slate-900'}`}>Productos</button>
            <button type="button" aria-pressed={featuredView === 'copy'} onClick={() => switchFeaturedView('copy')} className={`min-h-11 rounded-full border px-4 py-2 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] ${featuredView === 'copy' ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-300 bg-white text-slate-700 hover:border-slate-900'}`}>Título y descripción</button>
          </div>
          {featuredView === 'products' ? (
            <FeaturedProductsEditor onCancel={closeSection} onSaved={(message) => finishSection('featured', message, refreshProducts)} />
          ) : (
            <SectionCopyEditor
              dirtyKey="featured-section-copy"
              titleLabel="Título de la sección"
              subtitleLabel="Descripción"
              pickContent={(content) => content.featuredSection}
              getVersion={() => getSettingVersion('featured_section_content')}
              save={saveFeaturedSectionContent}
              savedMessage="Textos de Productos destacados guardados correctamente."
              onCancel={closeSection}
              onSaved={(message) => finishSection('featured', message, refreshLanding)}
            />
          )}
        </EditableSectionCard>

        <EditableSectionCard
          id="about-section"
          title="Acerca de Rehabex"
          description="La imagen y el mensaje que cuentan quiénes son."
          icon={Users}
          isOpen={openSection === 'about'}
          confirmation={confirmations.about}
          onToggle={() => toggleSection('about')}
          summary={(
            <div className="flex items-center gap-3">
              <SummaryImage url={landing.about.image} framing={landing.about.image_framing} alt="Vista previa de Acerca de Rehabex" />
              <p className="truncate text-sm font-semibold text-slate-900">{landing.about.title || 'Sin título'}</p>
            </div>
          )}
        >
          <AdminAboutPage part="about" onCancel={closeSection} onSaved={(message) => finishSection('about', message, refreshLanding)} />
        </EditableSectionCard>

        <EditableSectionCard
          id="metrics-section"
          title="Datos destacados"
          description="Dos datos breves para comunicar experiencia, atención o beneficios."
          icon={Gauge}
          isOpen={openSection === 'metrics'}
          confirmation={confirmations.metrics}
          onToggle={() => toggleSection('metrics')}
          summary={(
            <div className="flex flex-wrap gap-x-6 gap-y-2">
              {landing.about.metrics.map((metric) => (
                <div key={metric.id} className="min-w-0">
                  <span className="text-base font-semibold text-slate-900">{metric.value || '—'}</span>
                  <span className="ml-2 text-xs text-slate-500">{metric.label || 'Sin explicación'}</span>
                </div>
              ))}
            </div>
          )}
        >
          <AdminAboutPage part="metrics" onCancel={closeSection} onSaved={(message) => finishSection('metrics', message, refreshLanding)} />
        </EditableSectionCard>

        <EditableSectionCard
          id="catalog-section"
          title="Catálogo de productos"
          description="El título y el texto que invitan a recorrer toda la tienda."
          icon={LayoutGrid}
          isOpen={openSection === 'catalog'}
          confirmation={confirmations.catalog}
          onToggle={() => toggleSection('catalog')}
          summary={(
            <div>
              <p className="text-sm font-semibold text-slate-900">{landing.catalogSection.title || 'Sin título'}</p>
              <p className="mt-1 line-clamp-1 text-xs text-slate-500">{firstLine(landing.catalogSection.subtitle)}</p>
            </div>
          )}
        >
          <SectionCopyEditor
            dirtyKey="catalog-section-copy"
            titleLabel="Título de la sección"
            subtitleLabel="Descripción"
            pickContent={(content) => content.catalogSection}
            getVersion={() => getSettingVersion('catalog_section_content')}
            save={saveCatalogSectionContent}
            savedMessage="Textos del Catálogo guardados correctamente."
            onCancel={closeSection}
            onSaved={(message) => finishSection('catalog', message, refreshLanding)}
          />
        </EditableSectionCard>
      </div>
    </div>
  );
}
