import type { ElementType, HTMLAttributes, ReactNode } from 'react';

type AdminCardProps = {
  children: ReactNode;
  /** 'surface' (white, the default) or 'muted' (stone-50) -- the two background treatments already used across the panel. */
  tone?: 'surface' | 'muted';
  /** 'default' (p-5 sm:p-6) for a standalone section, 'compact' (p-4) for list-item-style cards, 'none' for a card that manages its own padding (e.g. a table). */
  padding?: 'default' | 'compact' | 'none';
  as?: ElementType;
  className?: string;
} & HTMLAttributes<HTMLElement>;

const PADDING_CLASSES: Record<NonNullable<AdminCardProps['padding']>, string> = {
  default: 'p-5 sm:p-6',
  compact: 'p-4',
  none: '',
};

const TONE_CLASSES: Record<NonNullable<AdminCardProps['tone']>, string> = {
  surface: 'bg-white',
  muted: 'bg-stone-50',
};

/**
 * The one card container for /admin. Replaces four different border-radius
 * values that accumulated across phases (rounded-2xl, rounded-[2rem],
 * rounded-[1.75rem], rounded-[1.5rem]) for what was always the same visual
 * role -- a bordered panel. Settled on rounded-2xl: it was already the most
 * common value and the one the current dashboard (the agreed visual
 * reference) uses throughout.
 */
export function AdminCard({ children, tone = 'surface', padding = 'default', as: Component = 'div', className, ...rest }: AdminCardProps) {
  return (
    <Component
      className={['rounded-2xl border border-slate-200', TONE_CLASSES[tone], PADDING_CLASSES[padding], className].filter(Boolean).join(' ')}
      {...rest}
    >
      {children}
    </Component>
  );
}
