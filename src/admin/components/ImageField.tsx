import { FormField } from './FormField';

type ImageFieldProps = {
  label: string;
  hint?: string;
  value: string;
  onChange: (value: string) => void;
};

export function ImageField({ label, hint, value, onChange }: ImageFieldProps) {
  return (
    <FormField label={label} hint={hint}>
      <div className="space-y-3">
        <input
          type="url"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder="https://..."
          className="admin-input"
        />
        <p className="text-xs leading-5 text-slate-500">
          Usa una URL HTTPS existente. La carga directa esta deshabilitada hasta contar con upload firmado.
        </p>
        <button
          type="button"
          disabled
          aria-disabled="true"
          className="cursor-not-allowed rounded-full border border-slate-200 bg-slate-100 px-4 py-2.5 text-sm font-medium text-slate-400"
        >
          Subir imagen (flujo seguro pendiente)
        </button>
        {value ? (
          <div className="overflow-hidden rounded-[1.5rem] border border-slate-200">
            <img src={value} alt={label} className="h-48 w-full object-cover object-center" />
          </div>
        ) : null}
      </div>
    </FormField>
  );
}
