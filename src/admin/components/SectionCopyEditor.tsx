import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';

import { getLandingContent } from '../../services/cms';
import { AdminApiError } from '../../services/adminApi';
import { AdminNotice } from './AdminNotice';
import { FormActions } from './FormActions';
import { FormField } from './FormField';
import { useUnsavedChanges } from '../unsavedChanges/UnsavedChangesContext';

export type SectionCopy = { title: string; subtitle: string };

function messageForApiError(error: unknown, fallback: string): string {
  if (error instanceof AdminApiError) return error.message;
  return error instanceof Error ? error.message : fallback;
}

type SectionCopyEditorProps = {
  dirtyKey: string;
  heading: string;
  description: string;
  titleLabel: string;
  titleHint?: string;
  subtitleLabel: string;
  subtitleHint?: string;
  pickContent: (landing: Awaited<ReturnType<typeof getLandingContent>>) => SectionCopy;
  getVersion: () => Promise<string | null>;
  save: (content: SectionCopy, expectedUpdatedAt: string | null) => Promise<{ content: SectionCopy; updatedAt: string }>;
  savedMessage: string;
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
    load();
    return () => {
      mounted = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const isDirty = JSON.stringify(content) !== JSON.stringify(initialContent);
  useEffect(() => setDirty(dirtyKey, isDirty), [isDirty, setDirty, dirtyKey]);

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
      const saved = await save(content, expectedUpdatedAt);
      setContent(saved.content);
      setInitialContent(saved.content);
      setExpectedUpdatedAt(saved.updatedAt);
      setDirty(dirtyKey, false);
      setMessage(savedMessage);
    } catch (submitError) {
      setError(messageForApiError(submitError, 'No se pudo guardar esta sección.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="space-y-6 rounded-[2rem] border border-slate-200 bg-stone-50 p-5 sm:p-6">
      <header>
        <h3 className="text-lg font-semibold text-slate-900">{heading}</h3>
        <p className="mt-1 text-sm leading-6 text-slate-600">{description}</p>
      </header>

      {message ? <AdminNotice>{message}</AdminNotice> : null}
      {error ? (
        <p className="text-sm text-red-600" role="alert">
          {error}
        </p>
      ) : null}

      {isLoading ? (
        <div aria-busy="true" className="rounded-2xl border border-slate-200 bg-white p-5 text-sm text-slate-600">
          Cargando...
        </div>
      ) : (
        <form className="space-y-4" onSubmit={handleSubmit}>
          <FormField label={titleLabel} hint={titleHint}>
            <input
              type="text"
              value={content.title}
              onChange={(event) => setContent((current) => ({ ...current, title: event.target.value }))}
              className="admin-input"
            />
          </FormField>
          <FormField label={subtitleLabel} hint={subtitleHint}>
            <textarea
              value={content.subtitle}
              onChange={(event) => setContent((current) => ({ ...current, subtitle: event.target.value }))}
              rows={3}
              className="admin-input"
            />
          </FormField>
          <FormActions onCancel={handleCancel} saving={saving} />
        </form>
      )}
    </section>
  );
}
