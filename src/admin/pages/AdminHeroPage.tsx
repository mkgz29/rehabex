import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';

import { defaultLandingContent } from '../../lib/defaultContent';
import { hasSupabaseConfig } from '../../lib/supabase';
import { getLandingContent, saveHeroContent } from '../../services/cms';
import type { HeroContent } from '../../types/cms';
import { AdminNotice } from '../components/AdminNotice';
import { AdminPageHeader } from '../components/AdminPageHeader';
import { FormActions } from '../components/FormActions';
import { FormField } from '../components/FormField';
import { ImageField } from '../components/ImageField';

export function AdminHeroPage() {
  const [heroContent, setHeroContent] = useState<HeroContent>(defaultLandingContent.hero);
  const [initialHeroContent, setInitialHeroContent] = useState<HeroContent>(defaultLandingContent.hero);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const content = await getLandingContent();
        setHeroContent(content.hero);
        setInitialHeroContent(content.hero);
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
    setMessage(null);
    setError(null);
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    setMessage(null);
    setError(null);

    try {
      await saveHeroContent(heroContent);
      setInitialHeroContent(heroContent);
      setMessage(
        hasSupabaseConfig
          ? 'Hero guardado correctamente.'
          : 'Hero guardado en este navegador. Configura Supabase si quieres compartirlo o persistirlo globalmente.',
      );
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'No se pudo guardar el Hero.');
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
          Sin Supabase, los cambios se guardan en este navegador. Agrega `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY` para compartirlos o persistirlos globalmente.
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
            onChange={(value) => updateHero('image_url', value)}
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

            <FormField label="Link del CTA principal">
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
