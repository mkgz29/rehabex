import { useCallback, useEffect, useRef, useState } from 'react';

import { FramedImage } from '../../components/media/FramedImage';
import { resolveMediaSlotState } from '../../components/media/mediaSlotState';
import { ImagePreparationError, optimizeImageForUpload } from '../../lib/imageOptimization';
import { DEFAULT_FRAMING, type ImageFraming } from '../../lib/imageFraming';
import { MediaUploadError, uploadSecureImage, validateFileForUpload, type MediaIntent } from '../../services/mediaApi';
import { FormField } from './FormField';
import { ImageFramingDialog } from './ImageFramingDialog';

type ImageFieldProps = {
  label: string;
  hint?: string;
  value: string;
  intent: MediaIntent;
  isLoading?: boolean;
  framing?: ImageFraming;
  onFramingChange?: (framing: ImageFraming) => void;
  aspectRatio?: string;
  onAssetReady: (result: { assetId: string; url: string }) => void;
};

type UploadState =
  | { kind: 'idle' }
  | { kind: 'preparing'; previewUrl: string }
  | { kind: 'uploading'; previewUrl: string; percent: number }
  | { kind: 'verifying'; previewUrl: string }
  | { kind: 'ready'; previewUrl: string; warning: string | null }
  | { kind: 'error'; previewUrl: string | null; message: string };

export function ImageField({
  label,
  hint,
  value,
  intent,
  isLoading = false,
  framing = DEFAULT_FRAMING,
  onFramingChange,
  aspectRatio = '4 / 5',
  onAssetReady,
}: ImageFieldProps) {
  const [state, setState] = useState<UploadState>({ kind: 'idle' });
  const [persistedImageFailed, setPersistedImageFailed] = useState(false);
  const [framerOpen, setFramerOpen] = useState(false);
  const [framerUrl, setFramerUrl] = useState('');
  const [framingApplied, setFramingApplied] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => setPersistedImageFailed(false), [value]);

  const busy = state.kind === 'preparing' || state.kind === 'uploading' || state.kind === 'verifying';

  const openFramer = (url: string) => {
    if (!url || !onFramingChange) return;
    setFramerUrl(url);
    setFramerOpen(true);
  };

  const closeFramer = useCallback(() => setFramerOpen(false), []);

  const handleFileSelected = async (file: File) => {
    const originalPreviewUrl = URL.createObjectURL(file);
    setFramingApplied(false);
    setState({ kind: 'preparing', previewUrl: originalPreviewUrl });

    let optimized: File;
    let warning: string | null;
    try {
      const result = await optimizeImageForUpload(file);
      optimized = result.file;
      warning = result.warning;
    } catch (error) {
      const message = error instanceof ImagePreparationError ? error.message : 'No pudimos preparar esta imagen. Probá con otro archivo.';
      setState({ kind: 'error', previewUrl: originalPreviewUrl, message });
      return;
    }

    const previewUrl = URL.createObjectURL(optimized);
    URL.revokeObjectURL(originalPreviewUrl);
    const validation = await validateFileForUpload(optimized);
    if (!validation.ok) {
      setState({ kind: 'error', previewUrl, message: validation.message });
      return;
    }

    const controller = new AbortController();
    abortRef.current = controller;
    setState({ kind: 'uploading', previewUrl, percent: 0 });
    openFramer(previewUrl);

    try {
      const result = await uploadSecureImage(optimized, intent, {
        signal: controller.signal,
        onProgress: (percent) => setState((current) => (current.kind === 'uploading' ? { ...current, percent } : current)),
        onUploaded: () => setState({ kind: 'verifying', previewUrl }),
      });
      setState({ kind: 'ready', previewUrl: result.url, warning });
      setFramerUrl(result.url);
      onAssetReady(result);
    } catch (error) {
      const message = error instanceof MediaUploadError ? error.message : 'No se pudo subir la imagen.';
      setState({ kind: 'error', previewUrl, message });
    } finally {
      abortRef.current = null;
    }
  };

  const handleCancelUpload = () => {
    abortRef.current?.abort();
    setState({ kind: 'idle' });
    closeFramer();
    if (inputRef.current) inputRef.current.value = '';
  };

  const handleRetry = () => {
    setState({ kind: 'idle' });
    if (inputRef.current) inputRef.current.value = '';
    inputRef.current?.click();
  };

  const displayUrl = state.kind === 'idle' || state.kind === 'error' ? (state.kind === 'error' ? state.previewUrl ?? value : value) : state.previewUrl;
  const idleSlotState = resolveMediaSlotState({ isLoading, url: value, failed: persistedImageFailed });
  const showIdleSkeleton = state.kind === 'idle' && idleSlotState === 'loading';
  const showIdleEmpty = state.kind === 'idle' && idleSlotState === 'empty';
  const showIdlePersistedError = state.kind === 'idle' && idleSlotState === 'error';

  return (
    <FormField label={label} hint={hint}>
      <div className="space-y-3">
        {showIdleSkeleton ? (
          <div className="h-48 w-full rounded-2xl border border-slate-200 bg-slate-100" aria-busy="true"><span className="sr-only">Cargando imagen...</span></div>
        ) : showIdleEmpty ? (
          <div className="flex h-48 w-full items-center justify-center rounded-2xl border border-dashed border-slate-300 bg-slate-50"><p className="text-xs text-slate-500">Imagen no configurada.</p></div>
        ) : showIdlePersistedError ? (
          <div className="flex h-48 w-full items-center justify-center rounded-2xl border border-slate-200 bg-slate-50"><p className="text-xs text-slate-500">Imagen no disponible.</p></div>
        ) : displayUrl ? (
          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-slate-100">
            <FramedImage
              media={{ kind: 'image', url: displayUrl, framing }}
              alt={label}
              className="h-48 w-full"
              onError={() => { if (state.kind === 'idle') setPersistedImageFailed(true); }}
            />
          </div>
        ) : (
          <div className="flex h-48 w-full items-center justify-center rounded-2xl border border-dashed border-slate-300 bg-slate-50"><p className="text-xs text-slate-500">Imagen no configurada.</p></div>
        )}

        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          disabled={busy || isLoading}
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void handleFileSelected(file);
          }}
          className="sr-only"
          tabIndex={-1}
        />

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={busy || isLoading}
            onClick={() => inputRef.current?.click()}
            className="inline-flex min-h-11 items-center justify-center rounded-full border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {displayUrl ? 'Cambiar imagen' : 'Elegir imagen'}
          </button>
          {displayUrl && onFramingChange ? (
            <button
              type="button"
              disabled={busy && !framerOpen}
              onClick={() => openFramer(displayUrl)}
              className="inline-flex min-h-11 items-center justify-center rounded-full border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] disabled:cursor-not-allowed disabled:opacity-60"
            >
              Acomodar imagen
            </button>
          ) : null}
        </div>

        <p className="text-xs leading-5 text-slate-500">JPG, PNG o WebP, hasta 20 MB. La ajustamos automáticamente antes de subirla.</p>
        {state.kind === 'preparing' ? <p className="text-xs text-slate-500" aria-live="polite">Preparando imagen...</p> : null}
        {state.kind === 'uploading' ? (
          <div className="space-y-1" aria-live="polite">
            <p className="text-xs text-slate-500">Subiendo imagen... {state.percent}%</p>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-200"><div className="h-full rounded-full bg-[var(--color-primary)] transition-all" style={{ width: `${state.percent}%` }} /></div>
          </div>
        ) : null}
        {state.kind === 'verifying' ? <p className="text-xs text-slate-500" aria-live="polite">Verificando imagen...</p> : null}
        {state.kind === 'ready' || framingApplied ? (
          <div aria-live="polite">
            <p className="text-xs font-medium text-emerald-700">Imagen lista. Todavía falta presionar “Guardar cambios” en esta sección.</p>
            {state.kind === 'ready' && state.warning ? <p className="mt-1 text-xs text-amber-600">{state.warning}</p> : null}
          </div>
        ) : null}
        {state.kind === 'error' ? <p className="text-xs text-red-600" role="alert">{state.message}</p> : null}

        {busy || state.kind === 'error' ? (
          <div className="flex gap-2">
            {busy ? <button type="button" onClick={handleCancelUpload} className="rounded-full border border-slate-300 px-4 py-2 text-xs font-medium text-slate-700 transition hover:border-slate-900">Cancelar subida</button> : null}
            {state.kind === 'error' ? <button type="button" onClick={handleRetry} className="rounded-full border border-slate-300 px-4 py-2 text-xs font-medium text-slate-700 transition hover:border-slate-900">Reintentar</button> : null}
          </div>
        ) : null}

        <ImageFramingDialog
          open={framerOpen}
          url={framerUrl || displayUrl || ''}
          framing={framing}
          aspectRatio={aspectRatio}
          onCancel={closeFramer}
          onApply={(nextFraming) => {
            onFramingChange?.(nextFraming);
            setFramingApplied(true);
            closeFramer();
          }}
        />
      </div>
    </FormField>
  );
}
