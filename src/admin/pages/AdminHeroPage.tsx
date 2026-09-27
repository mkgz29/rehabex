import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';

import { defaultLandingContent } from '../../lib/defaultContent';
import { hasSupabaseConfig } from '../../lib/supabase';
import { getLandingContent } from '../../services/cms';
import { AdminApiError, getSettingVersion, saveHeroContent } from '../../services/adminApi';
import type { HeroContent } from '../../types/cms';
import { AdminNotice } from '../components/AdminNotice';
import { FormActions } from '../components/FormActions';
import { FormField } from '../components/FormField';
import { ImageField } from '../components/ImageField';
import { useUnsavedChanges } from '../unsavedChanges/UnsavedChangesContext';

function messageForApiError(error: unknown, fallback: string) {
  if (error instanceof AdminApiError) return error.message;
  return error instanceof Error ? error.message : fallback;
}

// Plain-language destinations for the main button, mapped to the real
// existing routes/anchors the public site already understands. No new
// destination is invented here -- picking one never changes link behaviour,
// it only changes how the choice is presented.
const CTA_DESTINATIONS = [
  { id: 'featured', label: 'Productos destacados', link: '#productos' },
  { id: 'store', label: 'Tienda', link: '/tienda' },
] as const;

type CtaDestinationId = (typeof CTA_DESTINATIONS)[number]['id'] | 'custom';

function destinationForLink(link: string): CtaDestinationId {
  const preset = CTA_DESTINATIONS.find((option) => option.link === link);
  return preset ? preset.id : 'custom';
}

export function AdminHeroPage() {
  const [heroContent, setHeroContent] = useState<HeroContent>(defaultLandingContent.hero);
  const [initialHeroContent, setInitialHeroContent] = useState<HeroContent>(defaultLandingContent.hero);
  const [expectedUpdatedAt, setExpectedUpdatedAt] = useState<string | null>(null);
  const [pendingImageAssetId, setPendingImageAssetId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { setDirty } = useUnsavedChanges();

  useEffect(() => {
    async function load() {
      try {
        const [content, version] = await Promise.all([getLandingContent(), getSettingVersion('hero_content')]);
        setHeroContent(content.hero);
        setInitialHeroContent(content.hero);
        setExpectedUpdatedAt(version);
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : 'No se pudo cargar la portada principal.');
      } finally {
        setIsLoading(false);
      }
    }

    load();
  }, []);

  const isDirty = JSON.stringify(heroContent) !== JSON.stringify(initialHeroContent);
  useEffect(() => setDirty('hero', isDirty), [isDirty, setDirty]);

  const updateHero = (field: keyof HeroContent, value: string) => {
    setHeroContent((current) => ({ ...current, [field]: value }));
  };

  const handleCancel = () => {
    setHeroContent(initialHeroContent);
    setPendingImageAssetId(null);
    setMessage(null);
    setError(null);
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    setMessage(null);
    setError(null);

    try {
      const saved = await saveHeroContent(heroContent, expectedUpdatedAt, pendingImageAssetId);
      setHeroContent(saved.content);
      setInitialHeroContent(saved.content);
      setExpectedUpdatedAt(saved.updatedAt);
      setPendingImageAssetId(null);
      setDirty('hero', false);
      setMessage('Portada principal guardada correctamente.');
    } catch (submitError) {
      setError(messageForApiError(submitError, 'No se pudo guardar la portada principal.'));
    } finally {
      setSaving(false);
    }
  };

  const ctaDestination = destinationForLink(heroContent.primary_cta_link);

  return (
    <section className="space-y-6 rounded-[2rem] border border-slate-200 bg-stone-50 p-5 sm:p-6">
      <header>
        <h3 className="text-lg font-semibold text-slate-900">Portada principal</h3>
        <p className="mt-1 text-sm leading-6 text-slate-600">
          La primera imagen y mensaje que ve cualquier visitante al entrar a la tienda.
        </p>
      </header>

      {!hasSupabaseConfig ? (
        <AdminNotice>
          Sin Supabase, esta sección no puede guardarse. Configurá un entorno local o staging verificado para continuar.
        </AdminNotice>
      ) : null}

      {message ? <AdminNotice>{message}</AdminNotice> : null}
      {error ? (
        <p className="text-sm text-red-600" role="alert">
          {error}
        </p>
      ) : null}

      <form className="space-y-6" onSubmit={handleSubmit}>
        <div className="grid gap-5 lg:grid-cols-2">
          <ImageField
            label="Imagen de portada"
            hint="Usá una imagen amplia y de buena calidad: es lo primero que ve la gente."
            value={heroContent.image_url}
            intent="hero"
            isLoading={isLoading}
            onAssetReady={({ assetId, url }) => {
              setPendingImageAssetId(assetId);
              updateHero('image_url', url);
            }}
          />

          <div className="space-y-4">
            <FormField label="Título principal" hint="Breve, directo y fácil de leer sobre la imagen.">
              <input
                type="text"
                value={heroContent.title}
                onChange={(event) => updateHero('title', event.target.value)}
                className="admin-input"
              />
            </FormField>

            <FormField label="Descripción" hint="Opcional. Una sola frase corta para apoyar el título.">
              <textarea
                value={heroContent.subtitle ?? ''}
                onChange={(event) => updateHero('subtitle', event.target.value)}
                rows={4}
                className="admin-input"
              />
            </FormField>

            <FormField label="Texto del botón">
              <input
                type="text"
                value={heroContent.primary_cta_text}
                onChange={(event) => updateHero('primary_cta_text', event.target.value)}
                className="admin-input"
              />
            </FormField>

            <FormField label="A dónde lleva el botón" hint="Elegí una sección de la tienda o escribí un enlace.">
              <select
                value={ctaDestination}
                onChange={(event) => {
                  const next = event.target.value as CtaDestinationId;
                  const preset = CTA_DESTINATIONS.find((option) => option.id === next);
                  if (preset) updateHero('primary_cta_link', preset.link);
                }}
                className="admin-input"
              >
                {CTA_DESTINATIONS.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
                <option value="custom">Enlace personalizado</option>
              </select>
              {ctaDestination === 'custom' ? (
                <input
                  type="text"
                  value={heroContent.primary_cta_link}
                  onChange={(event) => updateHero('primary_cta_link', event.target.value)}
                  placeholder="Pegá o escribí el enlace completo"
                  className="admin-input mt-3"
                  aria-label="Enlace personalizado para el botón"
                />
              ) : null}
            </FormField>
          </div>
        </div>

        <FormActions onCancel={handleCancel} saving={saving} />
      </form>
    </section>
  );
}
