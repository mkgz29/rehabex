import { useRef, useState } from 'react';
import type { ChangeEvent } from 'react';

import { uploadImageToCloudinary } from '../../services/cloudinary';
import { FormField } from './FormField';

type ImageFieldProps = {
  label: string;
  hint?: string;
  value: string;
  onChange: (value: string) => void;
};

export function ImageField({ label, hint, value, onChange }: ImageFieldProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];

    if (!file) {
      return;
    }

    try {
      setUploading(true);
      setError(null);
      const imageUrl = await uploadImageToCloudinary(file);
      onChange(imageUrl);
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : 'No se pudo subir la imagen.');
    } finally {
      setUploading(false);
      event.target.value = '';
    }
  };

  return (
    <FormField label={label} hint={hint}>
      <div className="space-y-3">
        <input
          type="url"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder="Pega una URL o sube una imagen"
          className="admin-input"
        />
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="brand-soft-hover rounded-full border border-slate-300 px-4 py-2.5 text-sm font-medium text-slate-700"
          >
            {uploading ? 'Subiendo imagen...' : 'Subir imagen'}
          </button>
          <input ref={inputRef} type="file" accept="image/*" onChange={handleFileChange} className="hidden" />
        </div>
        {error ? <p className="text-sm text-red-600">{error}</p> : null}
        {value ? (
          <div className="overflow-hidden rounded-[1.5rem] border border-slate-200">
            <img src={value} alt={label} className="h-48 w-full object-cover object-center" />
          </div>
        ) : null}
      </div>
    </FormField>
  );
}
