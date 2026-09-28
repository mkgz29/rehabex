import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';

import { defaultLandingContent } from '../../lib/defaultContent';
import { DEFAULT_FRAMING } from '../../lib/imageFraming';
import { hasSupabaseConfig } from '../../lib/supabase';
import { AdminApiError, getSettingVersion, saveAboutContent } from '../../services/adminApi';
import { getLandingContent } from '../../services/cms';
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

type AdminAboutPageProps = {
  part?: 'about' | 'metrics';
  onSaved?: (message: string) => void;
  onCancel?: () => void;
};

export function AdminAboutPage({ part = 'about', onSaved, onCancel }: AdminAboutPageProps = {}) {
  const [content, setContent] = useState<AboutContent>(defaultLandingContent.about);
  const [initialContent, setInitialContent] = useState<AboutContent>(defaultLandingContent.about);
  const [expectedUpdatedAt, setExpectedUpdatedAt] = useState<string | null>(null);
  const [pendingImageAssetId, setPendingImageAssetId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { setDirty } = useUnsavedChanges();
  const dirtyKey = part === 'about' ? 'about-copy' : 'about-metrics';

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
    void load();
  }, []);

  const isDirty = JSON.stringify(content) !== JSON.stringify(initialContent);
  useEffect(() => setDirty(dirtyKey, isDirty), [dirtyKey, isDirty, setDirty]);
  useEffect(() => () => setDirty(dirtyKey, false), [dirtyKey, setDirty]);

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
    setDirty(dirtyKey, false);
    onCancel?.();
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
      setDirty(dirtyKey, false);
      const savedMessage = part === 'about' ? 'Acerca de Rehabex guardado correctamente.' : 'Datos destacados guardados correctamente.';
      setMessage(savedMessage);
      onSaved?.(savedMessage);
    } catch (submitError) {
      setError(messageForApiError(submitError, 'No se pudo guardar la sección.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-5">
      {!hasSupabaseConfig ? (
        <AdminNotice>Esta sección no puede guardarse en este entorno. Probá nuevamente desde el entorno de administración habilitado.</AdminNotice>
      ) : null}
      {message ? <AdminNotice>{message}</AdminNotice> : null}
      {error ? <p className="text-sm text-red-600" role="alert">{error}</p> : null}

      <form className="space-y-5" onSubmit={handleSubmit}>
        {part === 'about' ? (
          <div className="grid gap-5 xl:grid-cols-2">
            <ImageField
              label="Imagen de la sección"
              hint="Usá una foto del equipo o del espacio de trabajo."
              value={content.image}
              intent="about"
              isLoading={isLoading}
              framing={content.image_framing ?? DEFAULT_FRAMING}
              onFramingChange={(framing) => setContent((current) => ({ ...current, image_framing: framing }))}
              aspectRatio="4 / 5"
              onAssetReady={({ assetId, url }) => {
                setPendingImageAssetId(assetId);
                setContent((current) => ({ ...current, image: url }));
              }}
            />
            <div className="space-y-4">
              <FormField label="Título">
                <input type="text" value={content.title} onChange={(event) => setContent((current) => ({ ...current, title: event.target.value }))} className="admin-input" />
              </FormField>
              <FormField label="Descripción">
                <textarea value={content.description} onChange={(event) => setContent((current) => ({ ...current, description: event.target.value }))} rows={6} className="admin-input" />
              </FormField>
            </div>
          </div>
        ) : (
          <div className="grid gap-6 xl:grid-cols-2">
            {content.metrics.map((metric, index) => (
              <fieldset key={metric.id} className="space-y-4 border-t border-slate-200 pt-4 first:border-t-0 first:pt-0 xl:border-t-0 xl:border-l xl:pl-6 xl:first:border-l-0 xl:first:pl-0">
                <legend className="mb-3 text-sm font-semibold text-slate-900">Dato destacado {index + 1}</legend>
                <FormField label="Valor destacado">
                  <input type="text" value={metric.value} onChange={(event) => updateMetric(metric.id, 'value', event.target.value)} className="admin-input" />
                </FormField>
                <FormField label="Explicación">
                  <textarea value={metric.label} onChange={(event) => updateMetric(metric.id, 'label', event.target.value)} rows={3} className="admin-input" />
                </FormField>
              </fieldset>
            ))}
          </div>
        )}
        <FormActions onCancel={handleCancel} saving={saving} sticky />
      </form>
    </div>
  );
}
