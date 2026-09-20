import { Activity, BadgeCheck, PackageCheck, ShieldCheck } from 'lucide-react';

const trustItems = [
  { icon: ShieldCheck, title: 'Compra segura', text: 'Pagos gestionados con Mercado Pago.' },
  { icon: BadgeCheck, title: 'Atención personalizada', text: 'Orientación clara para elegir cada producto.' },
  { icon: PackageCheck, title: 'Stock informado', text: 'Disponibilidad visible antes de comprar.' },
  { icon: Activity, title: 'Selección especializada', text: 'Productos para rehabilitación y movilidad.' },
];

export function TrustStrip() {
  return (
    <section className="border-y border-line bg-surface" aria-label="Beneficios de comprar en Rehabex">
      <div className="site-container grid sm:grid-cols-2 lg:grid-cols-4">
        {trustItems.map(({ icon: Icon, title, text }, index) => (
          <div key={title} className={`flex gap-4 py-6 sm:px-5 lg:py-7 ${index > 0 ? 'border-t border-line sm:border-t-0' : ''} ${index % 2 === 1 ? 'sm:border-l' : ''} ${index > 1 ? 'sm:border-t lg:border-t-0' : ''} ${index > 0 ? 'lg:border-l' : ''}`}>
            <Icon className="mt-0.5 h-5 w-5 shrink-0 text-brand-hover" strokeWidth={1.8} aria-hidden="true" />
            <div>
              <h2 className="text-sm font-bold text-ink">{title}</h2>
              <p className="mt-1 text-xs leading-5 text-muted sm:text-sm">{text}</p>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
