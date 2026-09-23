import { useRef, useState } from 'react';

import { MediaUploadError, uploadSecureImage, validateFileForUpload, type MediaIntent } from '../../services/mediaApi';
import { FormField } from './FormField';

type ImageFieldProps = {
  label: string;
  hint?: string;
  /** Current display URL: the legacy or last-attached image. Read-only; never editable as free text. */
  value: string;
  intent: MediaIntent;
  /** Fired only after Cloudinary accepted the upload and the backend verified and registered it. */
  onAssetReady: (result: { assetId: string; url: string }) => void;
};

type UploadState =
  | { kind: 'idle' }
  | { kind: 'preparing'; previewUrl: string }
  | { kind: 'uploading'; previewUrl: string; percent: number }
  | { kind: 'verifying'; previewUrl: string }
  | { kind: 'ready'; previewUrl: string }
  | { kind: 'error'; previewUrl: string | null; message: string };

export function ImageField({ label, hint, value, intent, onAssetReady }: ImageFieldProps) {
  const [state, setState] = useState<UploadState>({ kind: 'idle' });
  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const busy = state.kind === 'preparing' || state.kind === 'uploading' || state.kind === 'verifying';

  const handleFileSelected = async (file: File) => {
    const previewUrl = URL.createObjectURL(file);
    setState({ kind: 'preparing', previewUrl });

    const validation = await validateFileForUpload(file);
    if (!validation.ok) {
      setState({ kind: 'error', previewUrl, message: validation.message });
      return;
    }

    const controller = new AbortController();
    abortRef.current = controller;
    try {
      setState({ kind: 'uploading', previewUrl, percent: 0 });
      const result = await uploadSecureImage(file, intent, {
        signal: controller.signal,
        onProgress: (percent) => setState((current) => (current.kind === 'uploading' ? { ...current, percent } : current)),
        onUploaded: () => setState({ kind: 'verifying', previewUrl }),
      });
      setState({ kind: 'ready', previewUrl: result.url });
      onAssetReady(result);
    } catch (error) {
      const message = error instanceof MediaUploadError ? error.message : 'No se pudo subir la imagen.';
      setState({ kind: 'error', previewUrl, message });
    } finally {
      abortRef.current = null;
    }
  };

  const handleCancel = () => {
    abortRef.current?.abort();
    setState({ kind: 'idle' });
    if (inputRef.current) inputRef.current.value = '';
  };

  const handleRetry = () => {
    setState({ kind: 'idle' });
    if (inputRef.current) inputRef.current.value = '';
    inputRef.current?.click();
  };

  // The previous image stays visible until a new upload is fully verified;
  // nothing here ever shows success before the server has confirmed it.
  const displayUrl = state.kind === 'idle' || state.kind === 'error' ? (state.kind === 'error' ? state.previewUrl ?? value : value) : state.previewUrl;

  return (
    <FormField label={label} hint={hint}>
      <div className="space-y-3">
        {displayUrl ? (
          <div className="overflow-hidden rounded-[1.5rem] border border-slate-200">
            <img src={displayUrl} alt={label} className="h-48 w-full object-cover object-center" />
          </div>
        ) : (
          <p className="text-xs text-slate-500">Todavia no hay una imagen cargada.</p>
        )}

        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          disabled={busy}
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) handleFileSelected(file);
          }}
          className="admin-input"
        />
        <p className="text-xs leading-5 text-slate-500">JPG, PNG o WebP. Maximo 8 MB. Entre 400x400 y 6000x6000 px.</p>

        {state.kind === 'preparing' ? <p className="text-xs text-slate-500">Preparando carga...</p> : null}
        {state.kind === 'uploading' ? (
          <div className="space-y-1">
            <p className="text-xs text-slate-500">Subiendo imagen... {state.percent}%</p>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-200">
              <div className="h-full rounded-full bg-[var(--color-primary)] transition-all" style={{ width: `${state.percent}%` }} />
            </div>
          </div>
        ) : null}
        {state.kind === 'verifying' ? <p className="text-xs text-slate-500">Verificando imagen...</p> : null}
        {state.kind === 'ready' ? <p className="text-xs text-emerald-600">Imagen lista. Guarda el formulario para confirmar el cambio.</p> : null}
        {state.kind === 'error' ? <p className="text-xs text-red-600">{state.message}</p> : null}

        {busy || state.kind === 'error' ? (
          <div className="flex gap-2">
            {busy ? (
              <button
                type="button"
                onClick={handleCancel}
                className="rounded-full border border-slate-300 px-4 py-2 text-xs font-medium text-slate-700 transition hover:border-slate-900"
              >
                Cancelar
              </button>
            ) : null}
            {state.kind === 'error' ? (
              <button
                type="button"
                onClick={handleRetry}
                className="rounded-full border border-slate-300 px-4 py-2 text-xs font-medium text-slate-700 transition hover:border-slate-900"
              >
                Reintentar
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    </FormField>
  );
}
