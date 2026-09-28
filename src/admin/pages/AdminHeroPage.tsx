import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';

import { DEFAULT_FRAMING } from '../../lib/imageFraming';
import { defaultLandingContent } from '../../lib/defaultContent';
import { hasSupabaseConfig } from '../../lib/supabase';
import { AdminApiError, getSettingVersion, saveHeroContent } from '../../services/adminApi';
import { getLandingContent } from '../../services/cms';
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

const CTA_DESTINATIONS = [
  { id: 'featured', label: 'Productos destacados', link: '#productos' },
  { id: 'store', label: 'Tienda', link: '/tienda' },
] as const;

type CtaDestinationId = (typeof CTA_DESTINATIONS)[number]['id'] | 'custom';
type AdminHeroPageProps = { onSaved?: (message: string) => void; onCancel?: () => void };

function destinationForLink(link: string): CtaDestinationId {
  const preset = CTA_DESTINATIONS.find((option) => option.link === link);
  return preset ? preset.id : 'custom';
}

export function AdminHeroPage({ onSaved, onCancel }: AdminHeroPageProps = {}) {
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
    void load();
  }, []);

  const isDirty = JSON.stringify(heroContent) !== JSON.stringify(initialHeroContent);
  useEffect(() => setDirty('hero', isDirty), [isDirty, setDirty]);
  useEffect(() => () => setDirty('hero', false), [setDirty]);

  const updateHero = (field: keyof HeroContent, value: string) => {
    setHeroContent((current) => ({ ...current, [field]: value }));
  };

  const handleCancel = () => {
    setHeroContent(initialHeroContent);
    setPendingImageAssetId(null);
    setMessage(null);
    setError(null);
    setDirty('hero', false);
    onCancel?.();
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
      const savedMessage = 'Portada principal guardada correctamente.';
      setMessage(savedMessage);
      onSaved?.(savedMessage);
    } catch (submitError) {
      setError(messageForApiError(submitError, 'No se pudo guardar la portada principal.'));
    } finally {
      setSaving(false);
    }
  };

  const ctaDestination = destinationForLink(heroContent.primary_cta_link);

  return (
    <div className="space-y-5">
      {!hasSupabaseConfig ? (
        <AdminNotice>Esta sección no puede guardarse en este entorno. Probá nuevamente desde el entorno de administración habilitado.</AdminNotice>
      ) : null}
      {message ? <AdminNotice>{message}</AdminNotice> : null}
      {error ? <p className="text-sm text-red-600" role="alert">{error}</p> : null}

      <form className="space-y-5" onSubmit={handleSubmit}>
        <div className="grid gap-5 xl:grid-cols-2">
          <ImageField
            label="Imagen de portada"
            hint="Usá una imagen amplia y de buena calidad."
            value={heroContent.image_url}
            intent="hero"
            isLoading={isLoading}
            framing={heroContent.image_framing ?? DEFAULT_FRAMING}
            onFramingChange={(framing) => setHeroContent((current) => ({ ...current, image_framing: framing }))}
            aspectRatio="4 / 5"
            onAssetReady={({ assetId, url }) => {
              setPendingImageAssetId(assetId);
              updateHero('image_url', url);
            }}
          />

          <div className="space-y-4">
            <FormField label="Título principal" hint="Breve y fácil de leer sobre la imagen.">
              <input type="text" value={heroContent.title} onChange={(event) => updateHero('title', event.target.value)} className="admin-input" />
            </FormField>
            <FormField label="Descripción" hint="Opcional. Una sola frase corta.">
              <textarea value={heroContent.subtitle ?? ''} onChange={(event) => updateHero('subtitle', event.target.value)} rows={4} className="admin-input" />
            </FormField>
            <FormField label="Texto del botón">
              <input type="text" value={heroContent.primary_cta_text} onChange={(event) => updateHero('primary_cta_text', event.target.value)} className="admin-input" />
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
                {CTA_DESTINATIONS.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
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
        <FormActions onCancel={handleCancel} saving={saving} sticky />
      </form>
    </div>
  );
}
