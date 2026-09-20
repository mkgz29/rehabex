export function ProductCardSkeleton() {
  return (
    <div className="overflow-hidden rounded-card border border-line bg-surface" aria-hidden="true">
      <div className="aspect-[4/5] animate-pulse bg-line/65" />
      <div className="space-y-4 p-5">
        <div className="h-3 w-1/3 animate-pulse rounded bg-line" />
        <div className="h-5 w-4/5 animate-pulse rounded bg-line" />
        <div className="h-4 w-1/2 animate-pulse rounded bg-line" />
        <div className="h-11 animate-pulse rounded-control bg-line/75" />
      </div>
    </div>
  );
}
