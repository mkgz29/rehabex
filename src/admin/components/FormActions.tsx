type FormActionsProps = {
  onCancel: () => void;
  saving?: boolean;
  submitLabel?: string;
  sticky?: boolean;
};

export function FormActions({ onCancel, saving = false, submitLabel = 'Guardar cambios', sticky = false }: FormActionsProps) {
  return (
    <div className={`flex flex-col gap-3 border-t border-slate-200 pt-4 sm:flex-row ${sticky ? 'sticky bottom-0 z-10 -mx-5 bg-stone-50/95 px-5 pb-1 backdrop-blur sm:-mx-6 sm:px-6' : ''}`}>
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
        disabled={saving}
        className="inline-flex items-center justify-center rounded-full border border-slate-300 px-5 py-3 text-sm font-semibold text-slate-700 transition hover:border-slate-900 hover:bg-white disabled:cursor-not-allowed disabled:opacity-70"
      >
        Cancelar
      </button>
    </div>
  );
}
