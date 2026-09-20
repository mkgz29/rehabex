import { ArrowRight } from 'lucide-react';
import { Link } from 'react-router-dom';

import type { AboutContent, Product } from '../types/cms';
import { AboutGallery } from './AboutGallery';
import type { AboutGalleryItem } from './AboutGallery';

type AboutSectionProps = {
  content: AboutContent;
  products: Product[];
};

const principles = [
  { title: 'Rehabilitación', text: 'Equipamiento presentado para acompañar procesos de recuperación.' },
  { title: 'Movilidad', text: 'Soluciones vinculadas con movimiento, práctica y continuidad.' },
  { title: 'Bienestar', text: 'Productos orientados al cuidado cotidiano y funcional.' },
];

export function AboutSection({ content, products }: AboutSectionProps) {
  const galleryItems = getGalleryItems(content, products);

  return (
    <section id="quienes-somos" className="section-shell overflow-hidden bg-primary text-white" aria-labelledby="about-title">
      <div className="site-container">
        <div className="grid items-center gap-12 lg:grid-cols-[0.82fr_1.18fr] lg:gap-16">
          <div data-reveal-item>
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-white/60">Acerca de Rehabex</p>
            <h2 id="about-title" className="mt-5 max-w-[18ch] text-balance text-[clamp(2.25rem,4vw,4rem)] font-bold leading-[1.02] tracking-[-0.045em] text-white">{content.title}</h2>
            <div className="mt-7 max-w-xl space-y-4 text-base leading-7 text-white/70">
              <p>{content.description}</p>
              <p>Reunimos productos y accesorios para quienes buscan acompañar rehabilitación, movilidad y bienestar con información clara, disponibilidad visible y una navegación directa.</p>
            </div>
            <Link to="/tienda" className="group mt-8 inline-flex min-h-11 items-center justify-center gap-2 rounded-control border border-white/25 px-5 py-3 text-sm font-bold text-white transition hover:border-white hover:bg-white hover:text-primary">
              Conocer el catálogo
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" aria-hidden="true" />
            </Link>
          </div>

          <AboutGallery items={galleryItems} />
        </div>

        <div className="mt-14 grid border-y border-white/15 sm:grid-cols-3 lg:mt-20">
          {principles.map((principle, index) => (
            <div key={principle.title} data-reveal-item className={`py-7 sm:px-6 lg:py-9 ${index > 0 ? 'border-t border-white/15 sm:border-l sm:border-t-0' : ''}`}>
              <p className="text-lg font-bold text-white">{principle.title}</p>
              <p className="mt-2 max-w-xs text-sm leading-6 text-white/60">{principle.text}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function getGalleryItems(content: AboutContent, products: Product[]) {
  const items: AboutGalleryItem[] = [];
  const seenUrls = new Set<string>();

  const addItem = (item: AboutGalleryItem) => {
    if (!item.imageUrl || seenUrls.has(item.imageUrl)) return;
    seenUrls.add(item.imageUrl);
    items.push(item);
  };

  addItem({
    imageUrl: content.image,
    alt: 'Imagen editorial de Rehabex vinculada con rehabilitación y bienestar',
    label: 'Rehabilitación, movilidad y bienestar',
  });

  for (const product of products) {
    addItem({
      imageUrl: product.imageUrl,
      alt: product.name,
      label: product.name,
    });
    if (items.length === 5) break;
  }

  return items.slice(0, 5);
}
