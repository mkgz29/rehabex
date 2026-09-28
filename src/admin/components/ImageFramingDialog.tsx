import { useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';

import { DEFAULT_FRAMING, type ImageFraming } from '../../lib/imageFraming';
import { ImageFramerField } from './ImageFramerField';

type ImageFramingDialogProps = {
  open: boolean;
  url: string;
  framing: ImageFraming;
  aspectRatio?: string;
  returnFocusRef?: RefObject<HTMLElement>;
  onApply: (framing: ImageFraming) => void;
  onCancel: () => void;
};

const FOCUSABLE_SELECTOR = [
  'button:not([disabled])',
  '[href]',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

export function resolveFramingDialogResult(previous: ImageFraming, draft: ImageFraming, action: 'apply' | 'cancel'): ImageFraming {
  return action === 'apply' ? draft : previous;
}

export function ImageFramingDialog({
  open,
  url,
  framing,
  aspectRatio = '4 / 5',
  returnFocusRef,
  onApply,
  onCancel,
}: ImageFramingDialogProps) {
  const [draft, setDraft] = useState<ImageFraming>({ ...DEFAULT_FRAMING });
  const dialogRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef(onCancel);
  cancelRef.current = onCancel;

  useEffect(() => {
    if (!open) return;
    setDraft({ ...framing });
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = dialogRef.current;
    dialog?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        cancelRef.current();
        return;
      }
      if (event.key !== 'Tab' || !dialog) return;
      const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
      if (focusable.length === 0) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = previousOverflow;
      (returnFocusRef?.current ?? previouslyFocused)?.focus();
    };
  }, [open]);

  if (!open || !url) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex bg-slate-950/55 p-0 sm:items-center sm:justify-center sm:p-6"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="image-framing-title"
        tabIndex={-1}
        className="flex h-full w-full flex-col overflow-hidden bg-white outline-none sm:h-auto sm:max-h-[calc(100vh-3rem)] sm:max-w-xl sm:rounded-[2rem] sm:shadow-2xl"
      >
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-4 sm:px-6">
          <div>
            <h2 id="image-framing-title" className="text-lg font-semibold text-slate-900">Acomodar imagen</h2>
            <p className="mt-1 text-xs leading-5 text-slate-500">Elegí cómo se verá la imagen. Después todavía tenés que guardar los cambios de la sección.</p>
          </div>
          <button
            type="button"
            aria-label="Cerrar sin aplicar el encuadre"
            onClick={onCancel}
            className="flex min-h-11 min-w-11 items-center justify-center rounded-full border border-slate-300 text-lg text-slate-700 transition hover:border-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]"
          >
            ×
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-5 sm:p-6">
          <ImageFramerField url={url} framing={draft} onChange={setDraft} aspectRatio={aspectRatio} />
        </div>

        <div className="flex flex-col-reverse gap-3 border-t border-slate-200 bg-white px-5 py-4 sm:flex-row sm:justify-end sm:px-6">
          <button
            type="button"
            onClick={onCancel}
            className="inline-flex min-h-11 items-center justify-center rounded-full border border-slate-300 px-5 py-2.5 text-sm font-semibold text-slate-700 transition hover:border-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={() => onApply(resolveFramingDialogResult(framing, draft, 'apply'))}
            className="brand-button inline-flex min-h-11 items-center justify-center rounded-full px-5 py-2.5 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] focus-visible:ring-offset-2"
          >
            Listo
          </button>
        </div>
      </div>
    </div>
  );
}
