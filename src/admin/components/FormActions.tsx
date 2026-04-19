type FormActionsProps = {
  onCancel: () => void;
  saving?: boolean;
  submitLabel?: string;
};

export function FormActions({ onCancel, saving = false, submitLabel = 'Guardar' }: FormActionsProps) {
  return (
    <div className="flex flex-col gap-3 border-t border-slate-200 pt-5 sm:flex-row">
      <button
        type="submit"
        className="brand-button inline-flex items-center justify-center rounded-full px-5 py-3 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-70"
        disabled={saving}
      >
        {saving ? 'Guardando...' : submitLabel}
      </button>
      <button
        type="button"
        onClick={onCancel}
        className="inline-flex items-center justify-center rounded-full border border-slate-300 px-5 py-3 text-sm font-semibold text-slate-700 transition hover:border-slate-900 hover:bg-white"
      >
        Cancelar
      </button>
    </div>
  );
}
