import { ArrowUpRight, HeartPulse, PersonStanding, Sparkles, Waves } from 'lucide-react';
import { Link } from 'react-router-dom';

const icons = [HeartPulse, PersonStanding, Waves, Sparkles];

type CategoryCardProps = {
  name: string;
  productCount: number;
  index: number;
};

export function CategoryCard({ name, productCount, index }: CategoryCardProps) {
  const Icon = icons[index % icons.length];
  return (
    <Link to="/tienda" className="group flex min-h-52 flex-col justify-between rounded-card border border-line bg-surface p-6 shadow-soft transition duration-ui hover:-translate-y-0.5 hover:border-ink/20 hover:shadow-card">
      <span className="flex h-11 w-11 items-center justify-center rounded-control bg-brand-soft text-brand-hover">
        <Icon className="h-5 w-5" strokeWidth={1.8} aria-hidden="true" />
      </span>
      <div>
        <p className="text-xl font-bold tracking-[-0.025em] text-ink">{name}</p>
        <div className="mt-2 flex items-center justify-between text-sm text-muted">
          <span>{productCount} {productCount === 1 ? 'producto' : 'productos'}</span>
          <ArrowUpRight className="h-4 w-4 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" aria-hidden="true" />
        </div>
      </div>
    </Link>
  );
}
