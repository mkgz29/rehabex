import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';

import { defaultLandingContent } from '../../lib/defaultContent';
import { hasSupabaseConfig } from '../../lib/supabase';
import { getLandingContent } from '../../services/cms';
import { AdminApiError, getSettingVersion, saveHeroContent } from '../../services/adminApi';
import type { HeroContent } from '../../types/cms';
import { AdminNotice } from '../components/AdminNotice';
import { AdminPageHeader } from '../components/AdminPageHeader';
import { FormActions } from '../components/FormActions';
import { FormField } from '../components/FormField';
import { ImageField } from '../components/ImageField';

function messageForApiError(error: unknown, fallback: string) {
  if (error instanceof AdminApiError) return error.message;
  return error instanceof Error ? error.message : fallback;
}

export function AdminHeroPage() {
  const [heroContent, setHeroContent] = useState<HeroContent>(defaultLandingContent.hero);
  const [initialHeroContent, setInitialHeroContent] = useState<HeroContent>(defaultLandingContent.hero);
  const [expectedUpdatedAt, setExpectedUpdatedAt] = useState<string | null>(null);
  const [pendingImageAssetId, setPendingImageAssetId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const [content, version] = await Promise.all([getLandingContent(), getSettingVersion('hero_content')]);
        setHeroContent(content.hero);
        setInitialHeroContent(content.hero);
        setExpectedUpdatedAt(version);
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : 'No se pudo cargar el Hero.');
      }
    }

    load();
  }, []);

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
      setMessage('Hero guardado correctamente.');
    } catch (submitError) {
      setError(messageForApiError(submitError, 'No se pudo guardar el Hero.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="Hero"
        description="Edita un Hero visual con una sola imagen protagonista, texto corto y un unico CTA principal."
      />

      {!hasSupabaseConfig ? (
        <AdminNotice>
          Sin Supabase, esta seccion no puede guardarse. Configura un entorno local o staging verificado para continuar.
        </AdminNotice>
      ) : null}

      {message ? <AdminNotice>{message}</AdminNotice> : null}
      {error ? <p className="text-sm text-red-600">{error}</p> : null}

      <form className="space-y-6" onSubmit={handleSubmit}>
        <section className="grid gap-5 rounded-[2rem] border border-slate-200 bg-stone-50 p-5 lg:grid-cols-2">
          <ImageField
            label="Imagen principal"
            hint="Usa una imagen amplia y de alto impacto visual. Se recorta con object-cover en desktop y mobile."
            value={heroContent.image_url}
            intent="hero"
            onAssetReady={({ assetId, url }) => {
              setPendingImageAssetId(assetId);
              updateHero('image_url', url);
            }}
          />

          <div className="space-y-4">
            <FormField label="Titulo" hint="Breve, directo y facil de leer sobre la imagen.">
              <input
                type="text"
                value={heroContent.title}
                onChange={(event) => updateHero('title', event.target.value)}
                className="admin-input"
              />
            </FormField>

            <FormField label="Subtitulo" hint="Opcional. Una sola frase corta para apoyar el titulo.">
              <textarea
                value={heroContent.subtitle ?? ''}
                onChange={(event) => updateHero('subtitle', event.target.value)}
                rows={4}
                className="admin-input"
              />
            </FormField>

            <FormField label="Texto del CTA principal">
              <input
                type="text"
                value={heroContent.primary_cta_text}
                onChange={(event) => updateHero('primary_cta_text', event.target.value)}
                className="admin-input"
              />
            </FormField>

            <FormField label="Link del CTA principal" hint="Ruta interna (/tienda), ancla (#productos) o URL https.">
              <input
                type="text"
                value={heroContent.primary_cta_link}
                onChange={(event) => updateHero('primary_cta_link', event.target.value)}
                className="admin-input"
              />
            </FormField>
          </div>
        </section>

        <FormActions onCancel={handleCancel} saving={saving} />
      </form>
    </div>
  );
}
