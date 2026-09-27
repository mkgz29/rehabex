import { useRef, useState } from 'react';

import { MediaUploadError, uploadSecureImage, validateFileForUpload } from '../../services/mediaApi';
import {
  MAX_GALLERY_IMAGES,
  addImage,
  canAddMoreImages,
  moveAfter,
  moveBefore,
  removeImageAt,
  replaceImageAt,
  reorderByDrag,
  setPrimaryAt,
  type GalleryDraftItem,
} from '../catalog/productGallery';
import { FormField } from './FormField';

type UploadTarget = 'new' | number;

type UploadState =
  | { kind: 'idle' }
  | { kind: 'uploading'; target: UploadTarget; previewUrl: string; percent: number }
  | { kind: 'verifying'; target: UploadTarget; previewUrl: string }
  | { kind: 'error'; target: UploadTarget; message: string };

type ProductGalleryFieldProps = {
  items: GalleryDraftItem[];
  onChange: (items: GalleryDraftItem[]) => void;
  /** Identities (mediaAssetId, or url for a legacy item with no asset id) already saved on the server before this edit session started; removing one of these asks for confirmation first. */
  persistedIds: Set<string>;
};

export function ProductGalleryField({ items, onChange, persistedIds }: ProductGalleryFieldProps) {
  const [upload, setUpload] = useState<UploadState>({ kind: 'idle' });
  const [confirmRemoveIndex, setConfirmRemoveIndex] = useState<number | null>(null);
  const addInputRef = useRef<HTMLInputElement>(null);
  const replaceInputRef = useRef<HTMLInputElement>(null);
  const replaceTargetRef = useRef<number | null>(null);

  const busy = upload.kind === 'uploading' || upload.kind === 'verifying';

  const runUpload = async (file: File, target: UploadTarget) => {
    const validation = await validateFileForUpload(file);
    if (!validation.ok) {
      setUpload({ kind: 'error', target, message: validation.message });
      return;
    }

    const previewUrl = URL.createObjectURL(file);
    setUpload({ kind: 'uploading', target, previewUrl, percent: 0 });
    try {
      const result = await uploadSecureImage(file, 'product', {
        onProgress: (percent) => setUpload((current) => (current.kind === 'uploading' && current.target === target ? { ...current, percent } : current)),
        onUploaded: () => setUpload({ kind: 'verifying', target, previewUrl }),
      });
      if (target === 'new') {
        onChange(addImage(items, { mediaAssetId: result.assetId, url: result.url }));
      } else {
        onChange(replaceImageAt(items, target, { mediaAssetId: result.assetId, url: result.url }));
      }
      setUpload({ kind: 'idle' });
    } catch (error) {
      const message = error instanceof MediaUploadError ? error.message : 'No se pudo subir la imagen.';
      setUpload({ kind: 'error', target, message });
    }
  };

  const handleAddFile = (file: File) => {
    void runUpload(file, 'new');
  };

  const handleReplaceFile = (index: number, file: File) => {
    void runUpload(file, index);
  };

  const handleRemove = (index: number) => {
    const item = items[index];
    if (persistedIds.has(item.mediaAssetId ?? item.url) && confirmRemoveIndex !== index) {
      setConfirmRemoveIndex(index);
      return;
    }
    setConfirmRemoveIndex(null);
    onChange(removeImageAt(items, index));
  };

  const [dragIndex, setDragIndex] = useState<number | null>(null);

  return (
    <FormField label="Imágenes del producto" hint={`Hasta ${MAX_GALLERY_IMAGES} imágenes. Arrastrá para cambiar el orden, o usá los botones para moverlas.`}>
      <div className="space-y-4">
        {items.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-4 text-xs text-slate-500">
            Todavía no agregaste ninguna imagen. El producto puede guardarse igual.
          </p>
        ) : (
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {items.map((item, index) => {
              const isReplacing = (upload.kind === 'uploading' || upload.kind === 'verifying') && upload.target === index;
              const isConfirmingRemove = confirmRemoveIndex === index;
              return (
                <li
                  key={item.mediaAssetId ?? item.url}
                  draggable={!busy}
                  onDragStart={() => setDragIndex(index)}
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={(event) => {
                    event.preventDefault();
                    if (dragIndex !== null) onChange(reorderByDrag(items, dragIndex, index));
                    setDragIndex(null);
                  }}
                  className="space-y-2 rounded-2xl border border-slate-200 bg-white p-2"
                >
                  <p className="text-center text-[11px] font-medium text-slate-500">
                    Imagen {index + 1} de {MAX_GALLERY_IMAGES}
                  </p>
                  <div className="relative overflow-hidden rounded-xl border border-slate-200">
                    <img
                      src={isReplacing && (upload.kind === 'uploading' || upload.kind === 'verifying') ? upload.previewUrl : item.url}
                      alt={`Imagen ${index + 1} del producto`}
                      className="h-28 w-full object-cover object-center"
                    />
                    {item.isPrimary ? (
                      <span className="absolute left-1.5 top-1.5 rounded-full bg-slate-900/85 px-2 py-1 text-[10px] font-semibold text-white">Imagen principal</span>
                    ) : null}
                  </div>

                  {isReplacing ? (
                    <p className="text-center text-[11px] text-slate-500">
                      {upload.kind === 'uploading' ? `Subiendo... ${upload.percent}%` : 'Verificando...'}
                    </p>
                  ) : (
                    <div className="flex flex-wrap justify-center gap-1">
                      {!item.isPrimary ? (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => onChange(setPrimaryAt(items, index))}
                          className="min-h-11 rounded-full border border-slate-300 px-2.5 py-1.5 text-[11px] font-medium text-slate-700 transition hover:border-slate-900 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          Usar como principal
                        </button>
                      ) : null}
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => {
                          replaceTargetRef.current = index;
                          replaceInputRef.current?.click();
                        }}
                        className="min-h-11 rounded-full border border-slate-300 px-2.5 py-1.5 text-[11px] font-medium text-slate-700 transition hover:border-slate-900 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        Cambiar imagen
                      </button>
                      <button
                        type="button"
                        disabled={busy || index === 0}
                        onClick={() => onChange(moveBefore(items, index))}
                        className="min-h-11 rounded-full border border-slate-300 px-2.5 py-1.5 text-[11px] font-medium text-slate-700 transition hover:border-slate-900 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        Mover antes
                      </button>
                      <button
                        type="button"
                        disabled={busy || index === items.length - 1}
                        onClick={() => onChange(moveAfter(items, index))}
                        className="min-h-11 rounded-full border border-slate-300 px-2.5 py-1.5 text-[11px] font-medium text-slate-700 transition hover:border-slate-900 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        Mover después
                      </button>

                      {isConfirmingRemove ? (
                        <span className="flex w-full flex-col items-center gap-1 pt-1">
                          <span className="text-[11px] text-slate-600">¿Quitar esta imagen?</span>
                          <span className="flex gap-1">
                            <button
                              type="button"
                              onClick={() => handleRemove(index)}
                              className="min-h-11 rounded-full border border-slate-900 bg-slate-900 px-2.5 py-1.5 text-[11px] font-medium text-white"
                            >
                              Sí, quitar
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirmRemoveIndex(null)}
                              className="min-h-11 rounded-full border border-slate-300 px-2.5 py-1.5 text-[11px] font-medium text-slate-700"
                            >
                              Cancelar
                            </button>
                          </span>
                        </span>
                      ) : (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => handleRemove(index)}
                          className="min-h-11 rounded-full border border-red-200 px-2.5 py-1.5 text-[11px] font-medium text-red-700 transition hover:border-red-500 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          Quitar imagen
                        </button>
                      )}
                    </div>
                  )}

                  {upload.kind === 'error' && upload.target === index ? (
                    <p role="alert" className="text-center text-[11px] text-red-600">
                      {upload.message}
                    </p>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}

        {canAddMoreImages(items) ? (
          <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-3">
            <input
              ref={addInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              disabled={busy}
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) handleAddFile(file);
                event.target.value = '';
              }}
              className="admin-input"
              aria-label="Agregar imagen"
            />
            <p className="mt-2 text-xs leading-5 text-slate-500">JPG, PNG o WebP. Máximo 8 MB. Entre 400x400 y 6000x6000 px.</p>
            {upload.kind === 'uploading' && upload.target === 'new' ? (
              <p className="mt-1 text-xs text-slate-500">Subiendo imagen... {upload.percent}%</p>
            ) : null}
            {upload.kind === 'verifying' && upload.target === 'new' ? <p className="mt-1 text-xs text-slate-500">Verificando imagen...</p> : null}
            {upload.kind === 'error' && upload.target === 'new' ? (
              <p role="alert" className="mt-1 text-xs text-red-600">
                {upload.message}
              </p>
            ) : null}
          </div>
        ) : (
          <p className="text-xs text-slate-500">Llegaste al máximo de {MAX_GALLERY_IMAGES} imágenes. Quitá una para agregar otra.</p>
        )}

        <input
          ref={replaceInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            const target = replaceTargetRef.current;
            if (file && target !== null) handleReplaceFile(target, file);
            event.target.value = '';
            replaceTargetRef.current = null;
          }}
        />
      </div>
    </FormField>
  );
}
