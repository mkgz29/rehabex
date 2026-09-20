type SectionHeadingProps = {
  eyebrow: string;
  title: string;
  description?: string;
  align?: 'left' | 'center';
  theme?: 'light' | 'dark';
};

export function SectionHeading({
  eyebrow,
  title,
  description,
  align = 'left',
  theme = 'light',
}: SectionHeadingProps) {
  const alignment = align === 'center' ? 'mx-auto max-w-reading text-center' : 'max-w-reading';
  const eyebrowColor = theme === 'dark' ? 'text-accent-soft' : 'text-accent';
  const titleColor = theme === 'dark' ? 'text-white' : 'text-ink';
  const descriptionColor = theme === 'dark' ? 'text-white/65' : 'text-muted';

  return (
    <div className={alignment}>
      <p className={`text-xs font-bold uppercase tracking-[0.2em] ${eyebrowColor}`}>{eyebrow}</p>
      <h2 className={`mt-4 text-balance text-3xl font-bold leading-[1.08] tracking-[-0.035em] sm:text-4xl lg:text-5xl ${titleColor}`}>
        {title}
      </h2>
      {description ? <p className={`mt-5 text-base leading-7 ${descriptionColor}`}>{description}</p> : null}
    </div>
  );
}
