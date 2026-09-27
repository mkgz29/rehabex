import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';

import { defaultLandingContent } from '../../lib/defaultContent';
import { hasSupabaseConfig } from '../../lib/supabase';
import { getLandingContent } from '../../services/cms';
import { AdminApiError, getSettingVersion, saveAboutContent } from '../../services/adminApi';
import type { AboutContent } from '../../types/cms';
import { AdminNotice } from '../components/AdminNotice';
import { FormActions } from '../components/FormActions';
import { FormField } from '../components/FormField';
import { ImageField } from '../components/ImageField';
import { useUnsavedChanges } from '../unsavedChanges/UnsavedChangesContext';

function messageForApiError(error: unknown, fallback: string) {
  if (error instanceof AdminApiError) return error.message;
  return error instanceof Error ? error.message : fallback;
}

export function AdminAboutPage() {
  const [content, setContent] = useState<AboutContent>(defaultLandingContent.about);
  const [initialContent, setInitialContent] = useState<AboutContent>(defaultLandingContent.about);
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
        const [landingContent, version] = await Promise.all([getLandingContent(), getSettingVersion('about_content')]);
        setContent(landingContent.about);
        setInitialContent(landingContent.about);
        setExpectedUpdatedAt(version);
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : 'No se pudo cargar la sección.');
      } finally {
        setIsLoading(false);
      }
    }

    load();
  }, []);

  const isDirty = JSON.stringify(content) !== JSON.stringify(initialContent);
  useEffect(() => setDirty('about', isDirty), [isDirty, setDirty]);

  const updateMetric = (metricId: string, field: 'value' | 'label', value: string) => {
    setContent((current) => ({
      ...current,
      metrics: current.metrics.map((metric) => (metric.id === metricId ? { ...metric, [field]: value } : metric)),
    }));
  };

  const handleCancel = () => {
    setContent(initialContent);
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
      const saved = await saveAboutContent(content, expectedUpdatedAt, pendingImageAssetId);
      setContent(saved.content);
      setInitialContent(saved.content);
      setExpectedUpdatedAt(saved.updatedAt);
      setPendingImageAssetId(null);
      setDirty('about', false);
      setMessage('Sección guardada correctamente.');
    } catch (submitError) {
      setError(messageForApiError(submitError, 'No se pudo guardar la sección.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="space-y-6 rounded-[2rem] border border-slate-200 bg-stone-50 p-5 sm:p-6">
      <header>
        <h3 className="text-lg font-semibold text-slate-900">Acerca de Rehabex</h3>
        <p className="mt-1 text-sm leading-6 text-slate-600">
          El mensaje y la imagen que cuentan quiénes son, junto con los datos destacados de la tienda.
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
            label="Imagen de la sección"
            hint="Usá una foto de equipo o del espacio de trabajo."
            value={content.image}
            intent="about"
            isLoading={isLoading}
            onAssetReady={({ assetId, url }) => {
              setPendingImageAssetId(assetId);
              setContent((current) => ({ ...current, image: url }));
            }}
          />

          <div className="space-y-4">
            <FormField label="Título">
              <input
                type="text"
                value={content.title}
                onChange={(event) => setContent((current) => ({ ...current, title: event.target.value }))}
                className="admin-input"
              />
            </FormField>

            <FormField label="Descripción">
              <textarea
                value={content.description}
                onChange={(event) => setContent((current) => ({ ...current, description: event.target.value }))}
                rows={6}
                className="admin-input"
              />
            </FormField>
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
          <h4 className="text-base font-semibold text-slate-900">Datos destacados</h4>
          <p className="mt-1 text-sm leading-6 text-slate-600">
            Usá esta sección para comunicar experiencia, atención o beneficios de Rehabex.
          </p>
          <div className="mt-5 grid gap-4 md:grid-cols-2">
            {content.metrics.map((metric, index) => (
              <div key={metric.id} className="rounded-2xl border border-slate-200 bg-stone-50 p-4">
                <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Dato destacado {index + 1}</p>
                <div className="mt-4 space-y-4">
                  <FormField label="Valor destacado">
                    <input
                      type="text"
                      value={metric.value}
                      onChange={(event) => updateMetric(metric.id, 'value', event.target.value)}
                      className="admin-input"
                    />
                  </FormField>
                  <FormField label="Explicación">
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
        </div>

        <FormActions onCancel={handleCancel} saving={saving} />
      </form>
    </section>
  );
}
