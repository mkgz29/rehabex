import type { ButtonHTMLAttributes } from 'react';

type AdminButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  size?: 'sm' | 'md';
};

const SECONDARY_SIZE_CLASSES: Record<NonNullable<AdminButtonProps['size']>, string> = {
  sm: 'px-3 py-1.5 text-xs',
  md: 'px-4 py-2 text-sm',
};

/**
 * The primary action button. Thin wrapper around the existing .brand-button
 * CSS class (src/index.css) -- that one was already consistent everywhere it
 * appeared, so this only gives it a name and a type-safe prop surface, it
 * does not change its look.
 */
export function AdminPrimaryButton({ className, type = 'button', ...rest }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button type={type} className={['brand-button', className].filter(Boolean).join(' ')} {...rest} />;
}

/**
 * The secondary/inline action button. Consolidates ~20 near-identical ad hoc
 * instances of `rounded-full border border-slate-300 ... text-slate-700
 * hover:border-slate-900` that had drifted into four different size/weight
 * combinations across AdminProductsPage, ProductGalleryField,
 * FeaturedProductsEditor, ImageField and ImageFramerField. Deliberately does
 * NOT replace FormActions' own Cancel button: that one is a distinct,
 * already-consistent primary/secondary submit pair embedded in every save
 * flow, and is left untouched to avoid any risk to those flows.
 */
export function AdminSecondaryButton({ size = 'md', className, type = 'button', ...rest }: AdminButtonProps) {
  return (
    <button
      type={type}
      className={[
        'inline-flex min-h-11 items-center justify-center rounded-full border border-slate-300 font-medium text-slate-700 transition hover:border-slate-900',
        'disabled:cursor-not-allowed disabled:opacity-60',
        SECONDARY_SIZE_CLASSES[size],
        className,
      ]
        .filter(Boolean)
        .join(' ')}
      {...rest}
    />
  );
}
