import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ComponentType } from 'react';
import type { LucideProps } from 'lucide-react';

export type IconButtonTone = 'neutral' | 'whatsapp' | 'archive' | 'reopen' | 'danger';

// Colors support the action, they are never the only signal: every instance
// also carries a distinct icon plus an aria-label/title with the real verb
// ("Archivar consulta", not just a tinted box). Archive is a soft amber, not
// the same red used for an actual destructive/irreversible action -- "Archivar"
// never deletes anything (FASE 7D.4).
const TONE_CLASSES: Record<IconButtonTone, string> = {
  neutral: 'border-slate-300 text-slate-700 hover:border-slate-900',
  whatsapp: 'border-emerald-200 text-emerald-700 hover:border-emerald-500 hover:bg-emerald-50',
  archive: 'border-amber-200 text-amber-700 hover:border-amber-400 hover:bg-amber-50',
  reopen: 'border-sky-200 text-sky-700 hover:border-sky-400 hover:bg-sky-50',
  danger: 'border-red-300 text-red-700 hover:border-red-500 hover:bg-red-50',
};

type SharedProps = {
  icon: ComponentType<LucideProps>;
  /** The action's visible/tooltip text (e.g. "Archivar") -- always the native title, and the sr-only/visible text when there is no more specific accessibleLabel. The project has no dedicated Tooltip component, so `title` is the minimal, dependency-free substitute. */
  label: string;
  /** Overrides the icon-only accessible name with more context than the short visible label carries (e.g. "Archivar consulta" instead of "Archivar") -- aria-label wins over the sr-only span's text either way, so this costs nothing visually. Defaults to `label`. */
  accessibleLabel?: string;
  /** Icon+text when true (ambiguous/primary actions); icon-only with a tooltip when false (obvious, repeated row/card actions) -- default false. */
  showLabel?: boolean;
  tone?: IconButtonTone;
  size?: 'sm' | 'md';
  className?: string;
};

type AdminIconButtonProps = SharedProps &
  (
    | ({ href: string } & Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href' | 'className' | 'title' | 'aria-label'>)
    | ({ href?: undefined } & Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className' | 'title' | 'aria-label'>)
  );

const ICON_SIZE_CLASS = { sm: 'h-4 w-4', md: 'h-[18px] w-[18px]' };

/**
 * Small, reusable action control for the repeated icon/icon+text buttons
 * across Admin (WhatsApp, Gmail, Archivar, Reabrir, Actualizar, Editar...).
 * Reuses the same pill shape/focus ring as AdminSecondaryButton, just adds
 * an icon slot, a semantic tone, and the icon-only touch target (min-h-11
 * min-w-11, same 44px minimum already used elsewhere in Admin).
 */
export function AdminIconButton({ icon: Icon, label, accessibleLabel = label, showLabel = false, tone = 'neutral', size = 'md', className, ...rest }: AdminIconButtonProps) {
  const base = [
    'inline-flex min-h-11 items-center justify-center gap-1.5 rounded-full border font-medium transition',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]',
    'disabled:cursor-not-allowed disabled:opacity-60',
    TONE_CLASSES[tone],
    showLabel ? (size === 'sm' ? 'px-3 py-1.5 text-xs' : 'px-4 py-2 text-sm') : 'min-w-11 px-0',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  const content = (
    <>
      <Icon aria-hidden="true" className={ICON_SIZE_CLASS[size]} />
      {showLabel ? <span>{label}</span> : <span className="sr-only">{label}</span>}
    </>
  );

  if ('href' in rest && rest.href) {
    const { href, ...anchorRest } = rest as { href: string } & AnchorHTMLAttributes<HTMLAnchorElement>;
    return (
      <a href={href} title={label} aria-label={showLabel ? undefined : accessibleLabel} className={base} {...anchorRest}>
        {content}
      </a>
    );
  }

  const { type = 'button', ...buttonRest } = rest as ButtonHTMLAttributes<HTMLButtonElement>;
  return (
    <button type={type} title={label} aria-label={showLabel ? undefined : accessibleLabel} className={base} {...buttonRest}>
      {content}
    </button>
  );
}
