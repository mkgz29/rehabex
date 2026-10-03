type StatusBadgeProps = {
  label: string;
  tone?: 'success' | 'warning' | 'danger' | 'neutral' | 'info';
  /** 'md' (default): OrdersTable's ringed pill. 'sm': FeaturedProductsEditor's compact ring-less pill, for a badge sitting inline next to a short label. */
  size?: 'sm' | 'md';
};

// Reuses the exact Tailwind palette colors OrdersTable's payment badges
// already render (emerald/amber/red/sky/slate with a matching ring) rather
// than the custom --color-success/warning/danger/info tokens: those tokens'
// RGB values were never verified to match these Tailwind shades, and Pedidos'
// badges are the most information-critical pattern in the panel -- a visual
// drift there was explicitly the regression to avoid, not just a structural
// one.
const TONE_CLASSES: Record<NonNullable<StatusBadgeProps['tone']>, string> = {
  success: 'bg-emerald-50 text-emerald-700',
  warning: 'bg-amber-50 text-amber-700',
  danger: 'bg-red-50 text-red-700',
  neutral: 'bg-slate-100 text-slate-600',
  info: 'bg-sky-50 text-sky-700',
};

const RING_CLASSES: Record<NonNullable<StatusBadgeProps['tone']>, string> = {
  success: 'ring-emerald-200',
  warning: 'ring-amber-200',
  danger: 'ring-red-200',
  neutral: 'ring-slate-200',
  info: 'ring-sky-200',
};

export function StatusBadge({ label, tone = 'neutral', size = 'md' }: StatusBadgeProps) {
  const sizeClasses = size === 'sm' ? 'px-2 py-0.5 text-[11px] font-semibold' : `px-3 py-1 text-xs font-semibold ring-1 ${RING_CLASSES[tone]}`;
  return <span className={`inline-flex rounded-full ${sizeClasses} ${TONE_CLASSES[tone]}`}>{label}</span>;
}
