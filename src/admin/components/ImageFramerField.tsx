import { useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';

import { DEFAULT_FRAMING, MAX_ZOOM, MIN_ZOOM, framingToImageStyle, type ImageFraming } from '../../lib/imageFraming';

type ImageFramerFieldProps = {
  /** The image to frame. When empty, the editor renders nothing (there is nothing to frame yet). */
  url: string;
  framing: ImageFraming;
  onChange: (framing: ImageFraming) => void;
  /** Box shape the frame previews, matching where this image is actually shown publicly. */
  aspectRatio?: string;
};

const STEP = 0.02;

export function ImageFramerField({ url, framing, onChange, aspectRatio = '4 / 5' }: ImageFramerFieldProps) {
  const previewRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);

  if (!url) return null;

  const style = framingToImageStyle(framing);
  const isFill = framing.mode === 'fill';

  const moveFocalTo = (clientX: number, clientY: number) => {
    const box = previewRef.current;
    if (!box) return;
    const rect = box.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    const focalX = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    const focalY = Math.min(1, Math.max(0, (clientY - rect.top) / rect.height));
    onChange({ ...framing, focalX, focalY });
  };

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!isFill) return;
    setDragging(true);
    event.currentTarget.setPointerCapture(event.pointerId);
    moveFocalTo(event.clientX, event.clientY);
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragging || !isFill) return;
    moveFocalTo(event.clientX, event.clientY);
  };

  const handlePointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragging) return;
    setDragging(false);
    event.currentTarget.releasePointerCapture(event.pointerId);
  };

  return (
    <div className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4">
      <div>
        <p className="text-sm font-medium text-slate-800">Acomodar imagen</p>
        <p className="mt-1 text-xs leading-5 text-slate-500">
          {isFill ? 'Arrastrá la imagen para elegir qué parte se ve mejor.' : 'Se muestra la imagen completa; puede quedar espacio libre alrededor.'}
        </p>
      </div>

      <div
        ref={previewRef}
        role="slider"
        aria-label="Posición de la imagen"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(framing.focalX * 100)}
        aria-valuetext={`Horizontal ${Math.round(framing.focalX * 100)} por ciento, vertical ${Math.round(framing.focalY * 100)} por ciento`}
        tabIndex={isFill ? 0 : -1}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onKeyDown={(event) => {
          if (!isFill) return;
          const step = event.shiftKey ? 0.1 : STEP;
          if (event.key === 'ArrowLeft') onChange({ ...framing, focalX: Math.max(0, framing.focalX - step) });
          if (event.key === 'ArrowRight') onChange({ ...framing, focalX: Math.min(1, framing.focalX + step) });
          if (event.key === 'ArrowUp') onChange({ ...framing, focalY: Math.max(0, framing.focalY - step) });
          if (event.key === 'ArrowDown') onChange({ ...framing, focalY: Math.min(1, framing.focalY + step) });
        }}
        className={`relative mx-auto w-full max-w-xs touch-none overflow-hidden rounded-xl border border-slate-300 bg-slate-100 outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] ${isFill ? 'cursor-move' : ''}`}
        style={{ aspectRatio }}
      >
        <img
          src={url}
          alt=""
          aria-hidden="true"
          draggable={false}
          style={{ objectFit: style.objectFit, objectPosition: style.objectPosition, transform: style.transform }}
          className="pointer-events-none h-full w-full select-none"
        />
      </div>

      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => onChange({ ...framing, mode: 'fill' })}
          aria-pressed={isFill}
          className={`min-h-11 flex-1 rounded-full border px-3 py-2 text-xs font-semibold transition ${isFill ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-300 text-slate-700 hover:border-slate-900'}`}
        >
          Llenar el espacio
        </button>
        <button
          type="button"
          onClick={() => onChange({ ...framing, mode: 'contain' })}
          aria-pressed={!isFill}
          className={`min-h-11 flex-1 rounded-full border px-3 py-2 text-xs font-semibold transition ${!isFill ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-300 text-slate-700 hover:border-slate-900'}`}
        >
          Mostrar imagen completa
        </button>
      </div>

      {isFill ? (
        <label className="block text-xs font-medium text-slate-700">
          Acercar o alejar
          <input
            type="range"
            min={MIN_ZOOM}
            max={MAX_ZOOM}
            step={0.05}
            value={framing.zoom}
            onChange={(event) => onChange({ ...framing, zoom: Number(event.target.value) })}
            aria-label="Acercar o alejar la imagen"
            className="mt-2 w-full"
          />
        </label>
      ) : null}

      <button
        type="button"
        onClick={() => onChange({ ...DEFAULT_FRAMING })}
        className="min-h-11 rounded-full border border-slate-300 px-4 py-2 text-xs font-medium text-slate-700 transition hover:border-slate-900"
      >
        Restablecer posición
      </button>
    </div>
  );
}
