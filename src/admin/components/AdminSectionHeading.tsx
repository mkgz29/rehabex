type AdminSectionHeadingProps = {
  title: string;
  description?: string;
  /** Heading level/size: 'h2' is page-level (reserved for AdminPageHeader), 'h3' is a card title, 'h4' is a sub-card title inside a card. */
  as?: 'h2' | 'h3' | 'h4';
  className?: string;
};

const HEADING_CLASSES: Record<NonNullable<AdminSectionHeadingProps['as']>, string> = {
  h2: 'text-2xl font-semibold tracking-tight text-slate-950',
  h3: 'text-lg font-semibold text-slate-900',
  h4: 'text-base font-semibold text-slate-900',
};

/**
 * The title+description text block repeated, with small drifts (text-slate-950
 * vs -900, text-lg vs text-base used inconsistently for the same role), across
 * AdminPageHeader, EditableSectionCard, SectionCopyEditor and ad hoc card
 * headers. No chrome of its own -- composes inside AdminCard or standalone.
 */
export function AdminSectionHeading({ title, description, as = 'h3', className }: AdminSectionHeadingProps) {
  const Heading = as;
  return (
    <div className={className}>
      <Heading className={HEADING_CLASSES[as]}>{title}</Heading>
      {description ? <p className="mt-1 text-sm leading-6 text-slate-600">{description}</p> : null}
    </div>
  );
}
