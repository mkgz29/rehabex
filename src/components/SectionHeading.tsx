type SectionHeadingProps = {
  eyebrow: string;
  title: string;
  description?: string;
  align?: 'left' | 'center';
  theme?: 'light' | 'dark';
  /** While true, title/description render as a skeleton instead of the passed-in text (defaults to false: existing callers are unaffected). */
  isLoading?: boolean;
};

export function SectionHeading({
  eyebrow,
  title,
  description,
  align = 'left',
  theme = 'light',
  isLoading = false,
}: SectionHeadingProps) {
  const alignment = align === 'center' ? 'mx-auto max-w-reading text-center' : 'max-w-reading';
  const eyebrowColor = theme === 'dark' ? 'text-accent-soft' : 'text-accent';
  const titleColor = theme === 'dark' ? 'text-white' : 'text-ink';
  const descriptionColor = theme === 'dark' ? 'text-white/65' : 'text-muted';
  const skeletonColor = theme === 'dark' ? 'bg-white/15' : 'bg-line';

  return (
    <div className={alignment}>
      <p className={`text-xs font-bold uppercase tracking-[0.2em] ${eyebrowColor}`}>{eyebrow}</p>
      {isLoading ? (
        <div className="mt-4 space-y-3" aria-hidden="true">
          <div className={`h-9 w-3/4 animate-pulse rounded sm:h-10 lg:h-11 ${skeletonColor}`} />
          <div className={`h-5 w-1/2 animate-pulse rounded ${skeletonColor}`} />
        </div>
      ) : (
        <>
          <h2 className={`mt-4 text-balance text-3xl font-bold leading-[1.08] tracking-[-0.035em] sm:text-4xl lg:text-5xl ${titleColor}`}>
            {title}
          </h2>
          {description ? <p className={`mt-5 text-base leading-7 ${descriptionColor}`}>{description}</p> : null}
        </>
      )}
    </div>
  );
}
