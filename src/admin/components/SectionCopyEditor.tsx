import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';

import { AdminApiError } from '../../services/adminApi';
import { getLandingContent } from '../../services/cms';
import { useUnsavedChanges } from '../unsavedChanges/UnsavedChangesContext';
import { AdminNotice } from './AdminNotice';
import { FormActions } from './FormActions';
import { FormField } from './FormField';

export type SectionCopy = { title: string; subtitle: string };

function messageForApiError(error: unknown, fallback: string): string {
  if (error instanceof AdminApiError) return error.message;
  return error instanceof Error ? error.message : fallback;
}

type SectionCopyEditorProps = {
  dirtyKey: string;
  heading?: string;
  description?: string;
  titleLabel: string;
  titleHint?: string;
  subtitleLabel: string;
  subtitleHint?: string;
  pickContent: (landing: Awaited<ReturnType<typeof getLandingContent>>) => SectionCopy;
  getVersion: () => Promise<string | null>;
  save: (content: SectionCopy, expectedUpdatedAt: string | null) => Promise<{ content: SectionCopy; updatedAt: string }>;
  savedMessage: string;
  onSaved?: (message: string) => void;
  onCancel?: () => void;
};

export function SectionCopyEditor({
  dirtyKey,
  heading,
  description,
  titleLabel,
  titleHint,
  subtitleLabel,
  subtitleHint,
  pickContent,
  getVersion,
  save,
  savedMessage,
  onSaved,
  onCancel,
}: SectionCopyEditorProps) {
  const [content, setContent] = useState<SectionCopy>({ title: '', subtitle: '' });
  const [initialContent, setInitialContent] = useState<SectionCopy>({ title: '', subtitle: '' });
  const [expectedUpdatedAt, setExpectedUpdatedAt] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { setDirty } = useUnsavedChanges();

  useEffect(() => {
    let mounted = true;
    async function load() {
      try {
        const [landing, version] = await Promise.all([getLandingContent(), getVersion()]);
        if (!mounted) return;
        const picked = pickContent(landing);
        setContent(picked);
        setInitialContent(picked);
        setExpectedUpdatedAt(version);
      } catch (loadError) {
        if (mounted) setError(loadError instanceof Error ? loadError.message : 'No se pudo cargar esta sección.');
      } finally {
        if (mounted) setIsLoading(false);
      }
    }
    void load();
    return () => { mounted = false; };
    // The editor intentionally loads once per opening.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const isDirty = JSON.stringify(content) !== JSON.stringify(initialContent);
  useEffect(() => setDirty(dirtyKey, isDirty), [dirtyKey, isDirty, setDirty]);
  useEffect(() => () => setDirty(dirtyKey, false), [dirtyKey, setDirty]);

  const handleCancel = () => {
    setContent(initialContent);
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
      const saved = await save(content, expectedUpdatedAt);
      setContent(saved.content);
      setInitialContent(saved.content);
      setExpectedUpdatedAt(saved.updatedAt);
      setDirty(dirtyKey, false);
      setMessage(savedMessage);
      onSaved?.(savedMessage);
    } catch (submitError) {
      setError(messageForApiError(submitError, 'No se pudo guardar esta sección.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      {heading ? (
        <div>
          <h3 className="text-base font-semibold text-slate-900">{heading}</h3>
          {description ? <p className="mt-1 text-sm leading-6 text-slate-600">{description}</p> : null}
        </div>
      ) : null}
      {message ? <AdminNotice>{message}</AdminNotice> : null}
      {error ? <p className="text-sm text-red-600" role="alert">{error}</p> : null}
      {isLoading ? (
        <div aria-busy="true" className="py-4 text-sm text-slate-600">Cargando...</div>
      ) : (
        <form className="space-y-4" onSubmit={handleSubmit}>
          <FormField label={titleLabel} hint={titleHint}>
            <input type="text" value={content.title} onChange={(event) => setContent((current) => ({ ...current, title: event.target.value }))} className="admin-input" />
          </FormField>
          <FormField label={subtitleLabel} hint={subtitleHint}>
            <textarea value={content.subtitle} onChange={(event) => setContent((current) => ({ ...current, subtitle: event.target.value }))} rows={3} className="admin-input" />
          </FormField>
          <FormActions onCancel={handleCancel} saving={saving} sticky />
        </form>
      )}
    </div>
  );
}
