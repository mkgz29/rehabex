import { useCallback, useEffect, useRef, useState } from 'react';

import { FramedImage } from '../../components/media/FramedImage';
import { resolveMediaSlotState } from '../../components/media/mediaSlotState';
import { ImagePreparationError, optimizeImageForUpload } from '../../lib/imageOptimization';
import { DEFAULT_FRAMING, type ImageFraming } from '../../lib/imageFraming';
import { MediaUploadError, mediaTypeForFile, uploadSecureMedia, validateMediaFileForUpload, type MediaIntent, type MediaType } from '../../services/mediaApi';
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
  allowVideo?: boolean;
  mediaType?: MediaType;
  onRemove?: () => void;
  onAssetReady: (result: { assetId: string; url: string; mediaType: MediaType }) => void;
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
  allowVideo = false,
  mediaType = 'image',
  onRemove,
  onAssetReady,
}: ImageFieldProps) {
  const [state, setState] = useState<UploadState>({ kind: 'idle' });
  const [persistedImageFailed, setPersistedImageFailed] = useState(false);
  const [framerOpen, setFramerOpen] = useState(false);
  const [framerUrl, setFramerUrl] = useState('');
  const [framingApplied, setFramingApplied] = useState(false);
  const [previewMediaType, setPreviewMediaType] = useState<MediaType>(mediaType);
  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    setPersistedImageFailed(false);
    setPreviewMediaType(mediaType);
  }, [mediaType, value]);

  const busy = state.kind === 'preparing' || state.kind === 'uploading' || state.kind === 'verifying';

  const openFramer = (url: string) => {
    if (!url || !onFramingChange) return;
    setFramerUrl(url);
    setFramerOpen(true);
  };

  const closeFramer = useCallback(() => setFramerOpen(false), []);

  const handleFileSelected = async (file: File) => {
    const originalPreviewUrl = URL.createObjectURL(file);
    const selectedMediaType = mediaTypeForFile(file);
    if (!selectedMediaType || (selectedMediaType === 'video' && !allowVideo)) {
      setState({ kind: 'error', previewUrl: originalPreviewUrl, message: allowVideo ? 'Formato no permitido. Usá JPG, PNG, WebP, MP4 o WebM.' : 'Formato no permitido. Usá una imagen JPG, PNG o WebP.' });
      return;
    }
    setPreviewMediaType(selectedMediaType);
    setFramingApplied(false);
    setState({ kind: 'preparing', previewUrl: originalPreviewUrl });

    let preparedFile = file;
    let warning: string | null = null;
    if (selectedMediaType === 'image') {
      try {
        const result = await optimizeImageForUpload(file);
        preparedFile = result.file;
        warning = result.warning;
      } catch (error) {
        const message = error instanceof ImagePreparationError ? error.message : 'No pudimos preparar esta imagen. Probá con otro archivo.';
        setState({ kind: 'error', previewUrl: originalPreviewUrl, message });
        return;
      }
    }

    const previewUrl = selectedMediaType === 'image' ? URL.createObjectURL(preparedFile) : originalPreviewUrl;
    if (selectedMediaType === 'image') URL.revokeObjectURL(originalPreviewUrl);
    const validation = await validateMediaFileForUpload(preparedFile, selectedMediaType);
    if (!validation.ok) {
      setState({ kind: 'error', previewUrl, message: validation.message });
      return;
    }

    const controller = new AbortController();
    abortRef.current = controller;
    setState({ kind: 'uploading', previewUrl, percent: 0 });
    if (selectedMediaType === 'image') openFramer(previewUrl);

    try {
      const result = await uploadSecureMedia(preparedFile, intent, selectedMediaType, {
        signal: controller.signal,
        onProgress: (percent) => setState((current) => (current.kind === 'uploading' ? { ...current, percent } : current)),
        onUploaded: () => setState({ kind: 'verifying', previewUrl }),
      });
      setState({ kind: 'ready', previewUrl: result.url, warning });
      setFramerUrl(result.url);
      onAssetReady(result);
    } catch (error) {
      const message = error instanceof MediaUploadError ? error.message : 'No se pudo subir el archivo.';
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

  const handleRemove = () => {
    abortRef.current?.abort();
    setState({ kind: 'idle' });
    setPreviewMediaType('image');
    setFramingApplied(false);
    closeFramer();
    if (inputRef.current) inputRef.current.value = '';
    onRemove?.();
  };

  const displayUrl = state.kind === 'idle' || state.kind === 'error' ? (state.kind === 'error' ? state.previewUrl ?? value : value) : state.previewUrl;
  const displayMediaType = state.kind === 'idle' ? mediaType : previewMediaType;
  const idleSlotState = resolveMediaSlotState({ isLoading, url: value, failed: persistedImageFailed });
  const showIdleSkeleton = state.kind === 'idle' && idleSlotState === 'loading';
  const showIdleEmpty = state.kind === 'idle' && idleSlotState === 'empty';
  const showIdlePersistedError = state.kind === 'idle' && idleSlotState === 'error';

  return (
    <FormField label={label} hint={hint}>
      <div className="space-y-3">
        {showIdleSkeleton ? (
          <div className="h-48 w-full rounded-2xl border border-slate-200 bg-slate-100" aria-busy="true"><span className="sr-only">Cargando archivo...</span></div>
        ) : showIdleEmpty ? (
          <div className="flex h-48 w-full items-center justify-center rounded-2xl border border-dashed border-slate-300 bg-slate-50"><p className="text-xs text-slate-500">{allowVideo ? 'Imagen o video no configurado.' : 'Imagen no configurada.'}</p></div>
        ) : showIdlePersistedError ? (
          <div className="flex h-48 w-full items-center justify-center rounded-2xl border border-slate-200 bg-slate-50"><p className="text-xs text-slate-500">Archivo no disponible.</p></div>
        ) : displayUrl ? (
          <div className="relative overflow-hidden rounded-2xl border border-slate-200 bg-slate-100">
            <FramedImage
              media={{ kind: displayMediaType, url: displayUrl, framing }}
              alt={label}
              className="h-48 w-full"
              controls={displayMediaType === 'video'}
              muted
              playsInline
              preload="metadata"
              onError={() => { if (state.kind === 'idle') setPersistedImageFailed(true); }}
            />
            <span className="absolute left-3 top-3 rounded-full bg-slate-950/80 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.12em] text-white">{displayMediaType === 'video' ? 'Video' : 'Imagen'}</span>
          </div>
        ) : (
          <div className="flex h-48 w-full items-center justify-center rounded-2xl border border-dashed border-slate-300 bg-slate-50"><p className="text-xs text-slate-500">{allowVideo ? 'Imagen o video no configurado.' : 'Imagen no configurada.'}</p></div>
        )}

        <input
          ref={inputRef}
          type="file"
          accept={allowVideo ? 'image/jpeg,image/png,image/webp,video/mp4,video/webm' : 'image/jpeg,image/png,image/webp'}
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
            {displayUrl ? (allowVideo ? 'Cambiar archivo' : 'Cambiar imagen') : (allowVideo ? 'Elegir imagen o video' : 'Elegir imagen')}
          </button>
          {displayUrl && displayMediaType === 'image' && onFramingChange ? (
            <button
              type="button"
              disabled={busy && !framerOpen}
              onClick={() => openFramer(displayUrl)}
              className="inline-flex min-h-11 items-center justify-center rounded-full border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] disabled:cursor-not-allowed disabled:opacity-60"
            >
              Acomodar imagen
            </button>
          ) : null}
          {displayUrl && onRemove ? (
            <button
              type="button"
              disabled={busy || isLoading}
              onClick={handleRemove}
              className="inline-flex min-h-11 items-center justify-center rounded-full border border-red-200 bg-white px-4 py-2 text-sm font-semibold text-red-600 transition hover:bg-red-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 disabled:cursor-not-allowed disabled:opacity-60"
            >
              Eliminar archivo
            </button>
          ) : null}
        </div>

        <p className="text-xs leading-5 text-slate-500">{allowVideo ? 'Imágenes JPG, PNG o WebP; videos MP4 o WebM de hasta 8 MB y 60 segundos.' : 'JPG, PNG o WebP, hasta 20 MB. La ajustamos automáticamente antes de subirla.'}</p>
        {state.kind === 'preparing' ? <p className="text-xs text-slate-500" aria-live="polite">Preparando archivo...</p> : null}
        {state.kind === 'uploading' ? (
          <div className="space-y-1" aria-live="polite">
            <p className="text-xs text-slate-500">Subiendo archivo... {state.percent}%</p>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-200"><div className="h-full rounded-full bg-[var(--color-primary)] transition-all" style={{ width: `${state.percent}%` }} /></div>
          </div>
        ) : null}
        {state.kind === 'verifying' ? <p className="text-xs text-slate-500" aria-live="polite">Verificando archivo...</p> : null}
        {state.kind === 'ready' || framingApplied ? (
          <div aria-live="polite">
            <p className="text-xs font-medium text-emerald-700">Archivo listo. Todavía falta presionar “Guardar cambios” en esta sección.</p>
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
