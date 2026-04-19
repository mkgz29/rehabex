import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';

import { defaultLandingContent } from '../../lib/defaultContent';
import { hasSupabaseConfig } from '../../lib/supabase';
import { getLandingContent, saveAboutContent } from '../../services/cms';
import type { AboutContent } from '../../types/cms';
import { AdminNotice } from '../components/AdminNotice';
import { AdminPageHeader } from '../components/AdminPageHeader';
import { FormActions } from '../components/FormActions';
import { FormField } from '../components/FormField';
import { ImageField } from '../components/ImageField';

export function AdminAboutPage() {
  const [content, setContent] = useState<AboutContent>(defaultLandingContent.about);
  const [initialContent, setInitialContent] = useState<AboutContent>(defaultLandingContent.about);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const landingContent = await getLandingContent();
        setContent(landingContent.about);
        setInitialContent(landingContent.about);
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : 'No se pudo cargar la seccion.');
      }
    }

    load();
  }, []);

  const updateMetric = (metricId: string, field: 'value' | 'label', value: string) => {
    setContent((current) => ({
      ...current,
      metrics: current.metrics.map((metric) => (metric.id === metricId ? { ...metric, [field]: value } : metric)),
    }));
  };

  const handleCancel = () => {
    setContent(initialContent);
    setMessage(null);
    setError(null);
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    setMessage(null);
    setError(null);

    try {
      await saveAboutContent(content);
      setInitialContent(content);
      setMessage(
        hasSupabaseConfig
          ? 'Seccion guardada correctamente.'
          : 'Vista local actualizada. Configura Supabase para persistir los cambios.',
      );
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'No se pudo guardar la seccion.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="Quienes somos"
        description="Actualiza la imagen, el mensaje principal y las metricas visibles sin tocar codigo."
      />

      {!hasSupabaseConfig ? (
        <AdminNotice>
          Estas viendo datos de ejemplo. Para guardar de forma permanente, agrega `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY`.
        </AdminNotice>
      ) : null}

      {message ? <AdminNotice>{message}</AdminNotice> : null}
      {error ? <p className="text-sm text-red-600">{error}</p> : null}

      <form className="space-y-6" onSubmit={handleSubmit}>
        <section className="grid gap-5 rounded-[2rem] border border-slate-200 bg-stone-50 p-5 lg:grid-cols-2">
          <ImageField
            label="Imagen"
            hint="Usa una foto de equipo o espacio profesional."
            value={content.image}
            onChange={(value) => setContent((current) => ({ ...current, image: value }))}
          />

          <div className="space-y-4">
            <FormField label="Titulo">
              <input
                type="text"
                value={content.title}
                onChange={(event) => setContent((current) => ({ ...current, title: event.target.value }))}
                className="admin-input"
              />
            </FormField>

            <FormField label="Descripcion">
              <textarea
                value={content.description}
                onChange={(event) => setContent((current) => ({ ...current, description: event.target.value }))}
                rows={6}
                className="admin-input"
              />
            </FormField>
          </div>
        </section>

        <section className="rounded-[2rem] border border-slate-200 bg-stone-50 p-5">
          <h3 className="text-lg font-semibold text-slate-900">Metricas</h3>
          <div className="mt-5 grid gap-4 md:grid-cols-2">
            {content.metrics.map((metric, index) => (
              <div key={metric.id} className="rounded-2xl border border-slate-200 bg-white p-4">
                <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Metrica {index + 1}</p>
                <div className="mt-4 space-y-4">
                  <FormField label="Valor destacado">
                    <input
                      type="text"
                      value={metric.value}
                      onChange={(event) => updateMetric(metric.id, 'value', event.target.value)}
                      className="admin-input"
                    />
                  </FormField>
                  <FormField label="Texto explicativo">
                    <textarea
                      value={metric.label}
                      onChange={(event) => updateMetric(metric.id, 'label', event.target.value)}
                      rows={3}
                      className="admin-input"
                    />
                  </FormField>
                </div>
              </div>
            ))}
          </div>
        </section>

        <FormActions onCancel={handleCancel} saving={saving} />
      </form>
    </div>
  );
}
