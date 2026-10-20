import { Eye, EyeOff, Lock, Mail } from 'lucide-react';
import { useState } from 'react';
import type { InputHTMLAttributes, ReactNode } from 'react';

type FieldProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'className' | 'id'> & {
  id: string;
  label: string;
};

// `admin-input` stays the base class (the hardened input shared across auth
// forms); the rest only re-skins it as a pill with room for the leading icon.
const INPUT_CLASS =
  'admin-input !min-h-[3rem] rounded-full border-line pl-11 text-[0.9375rem] ' +
  'focus-visible:border-brand focus-visible:shadow-[0_0_0_3px_rgb(var(--color-brand)/0.22)] ' +
  'aria-[invalid=true]:border-red-400 aria-[invalid=true]:focus-visible:shadow-[0_0_0_3px_rgb(248_113_113/0.3)]';

const ICON_CLASS = 'pointer-events-none absolute left-4 top-1/2 h-[1.125rem] w-[1.125rem] -translate-y-1/2 text-muted';

/** Visible label above the field (never a placeholder-only label). */
function FieldFrame({ id, label, children }: { id: string; label: string; children: ReactNode }) {
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-semibold text-ink">
        {label}
      </label>
      <div className="relative mt-2">{children}</div>
    </div>
  );
}

export function EmailField({ id, label, ...inputProps }: FieldProps) {
  return (
    <FieldFrame id={id} label={label}>
      <Mail className={ICON_CLASS} strokeWidth={1.8} aria-hidden="true" />
      <input type="email" id={id} className={`${INPUT_CLASS} pr-4`} {...inputProps} />
    </FieldFrame>
  );
}

export function PasswordField({ id, label, ...inputProps }: FieldProps) {
  const [visible, setVisible] = useState(false);

  return (
    <FieldFrame id={id} label={label}>
      <Lock className={ICON_CLASS} strokeWidth={1.8} aria-hidden="true" />
      <input type={visible ? 'text' : 'password'} id={id} className={`${INPUT_CLASS} pr-12`} {...inputProps} />
      <button
        type="button"
        onClick={() => setVisible((current) => !current)}
        aria-label={visible ? 'Ocultar contraseña' : 'Mostrar contraseña'}
        aria-pressed={visible}
        className="absolute right-1 top-1/2 inline-flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full text-muted transition-colors duration-200 hover:text-ink focus-visible:text-ink"
      >
        {visible ? <EyeOff className="h-[1.125rem] w-[1.125rem]" strokeWidth={1.8} aria-hidden="true" /> : <Eye className="h-[1.125rem] w-[1.125rem]" strokeWidth={1.8} aria-hidden="true" />}
      </button>
    </FieldFrame>
  );
}
