type SectionHeadingProps = {
  eyebrow: string;
  title: string;
  description: string;
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
  const alignment = align === 'center' ? 'mx-auto max-w-2xl text-center' : 'max-w-2xl';
  const eyebrowColor = theme === 'dark' ? 'brand-accent-text-soft' : 'brand-accent-text';
  const titleColor = theme === 'dark' ? 'text-white' : 'text-slate-900';
  const descriptionColor = theme === 'dark' ? 'text-slate-300' : 'text-slate-600';

  return (
    <div className={alignment}>
      <span className={`text-sm font-semibold uppercase tracking-[0.24em] ${eyebrowColor}`}>
        {eyebrow}
      </span>
      <h2 className={`mt-3 text-3xl font-semibold tracking-tight sm:text-4xl ${titleColor}`}>
        {title}
      </h2>
      <p className={`mt-4 text-base leading-7 ${descriptionColor}`}>{description}</p>
    </div>
  );
}
