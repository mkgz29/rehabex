import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';

import { defaultLandingContent } from '../../lib/defaultContent';
import { hasSupabaseConfig } from '../../lib/supabase';
import { getLandingContent, saveHeroContent } from '../../services/cms';
import type { HeroSlide } from '../../types/cms';
import { AdminNotice } from '../components/AdminNotice';
import { AdminPageHeader } from '../components/AdminPageHeader';
import { FormActions } from '../components/FormActions';
import { FormField } from '../components/FormField';
import { ImageField } from '../components/ImageField';

export function AdminHeroPage() {
  const [slides, setSlides] = useState<HeroSlide[]>(defaultLandingContent.hero.slides);
  const [initialSlides, setInitialSlides] = useState<HeroSlide[]>(defaultLandingContent.hero.slides);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const content = await getLandingContent();
        setSlides(content.hero.slides.slice(0, 3));
        setInitialSlides(content.hero.slides.slice(0, 3));
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : 'No se pudo cargar el Hero.');
      }
    }

    load();
  }, []);

  const updateSlide = (slideId: string, field: keyof HeroSlide, value: string) => {
    setSlides((current) => current.map((slide) => (slide.id === slideId ? { ...slide, [field]: value } : slide)));
  };

  const handleCancel = () => {
    setSlides(initialSlides);
    setMessage(null);
    setError(null);
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    setMessage(null);
    setError(null);

    try {
      await saveHeroContent({ slides: slides.slice(0, 3) });
      setInitialSlides(slides);
      setMessage(
        hasSupabaseConfig
          ? 'Hero guardado correctamente.'
          : 'Vista local actualizada. Configura Supabase para persistir los cambios.',
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
        description="Edita hasta 3 slides del Hero con imagen, titulo, subtitulo y dos botones por slide."
      />

      {!hasSupabaseConfig ? (
        <AdminNotice>
          Estas viendo datos de ejemplo. Para guardar de forma permanente, agrega `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY`.
        </AdminNotice>
      ) : null}

      {message ? <AdminNotice>{message}</AdminNotice> : null}
      {error ? <p className="text-sm text-red-600">{error}</p> : null}

      <form className="space-y-6" onSubmit={handleSubmit}>
        {slides.map((slide, index) => (
          <section key={slide.id} className="rounded-[2rem] border border-slate-200 bg-stone-50 p-5">
            <div className="mb-5 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-slate-900">Slide {index + 1}</h3>
              <span className="text-xs uppercase tracking-[0.2em] text-slate-400">Maximo 3 slides</span>
            </div>

            <div className="grid gap-5 lg:grid-cols-2">
              <ImageField
                label="Imagen principal"
                hint="Usa una imagen horizontal y profesional."
                value={slide.image}
                onChange={(value) => updateSlide(slide.id, 'image', value)}
              />

              <div className="space-y-4">
                <FormField label="Texto alternativo">
                  <input
                    type="text"
                    value={slide.alt}
                    onChange={(event) => updateSlide(slide.id, 'alt', event.target.value)}
                    className="admin-input"
                  />
                </FormField>
                <FormField label="Titulo">
                  <input
                    type="text"
                    value={slide.title}
                    onChange={(event) => updateSlide(slide.id, 'title', event.target.value)}
                    className="admin-input"
                  />
                </FormField>
                <FormField label="Subtitulo">
                  <textarea
                    value={slide.subtitle}
                    onChange={(event) => updateSlide(slide.id, 'subtitle', event.target.value)}
                    rows={4}
                    className="admin-input"
                  />
                </FormField>
              </div>
            </div>

            <div className="mt-5 grid gap-4 md:grid-cols-2">
              <FormField label="Boton principal">
                <input
                  type="text"
                  value={slide.primaryButtonText}
                  onChange={(event) => updateSlide(slide.id, 'primaryButtonText', event.target.value)}
                  className="admin-input"
                />
              </FormField>
              <FormField label="Link del boton principal">
                <input
                  type="text"
                  value={slide.primaryButtonLink}
                  onChange={(event) => updateSlide(slide.id, 'primaryButtonLink', event.target.value)}
                  className="admin-input"
                />
              </FormField>
              <FormField label="Boton secundario">
                <input
                  type="text"
                  value={slide.secondaryButtonText}
                  onChange={(event) => updateSlide(slide.id, 'secondaryButtonText', event.target.value)}
                  className="admin-input"
                />
              </FormField>
              <FormField label="Link del boton secundario">
                <input
                  type="text"
                  value={slide.secondaryButtonLink}
                  onChange={(event) => updateSlide(slide.id, 'secondaryButtonLink', event.target.value)}
                  className="admin-input"
                />
              </FormField>
            </div>
          </section>
        ))}

        <FormActions onCancel={handleCancel} saving={saving} />
      </form>
    </div>
  );
}
