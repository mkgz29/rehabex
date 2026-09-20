import type { AboutContent } from '../types/cms';
import { EditorialSplit } from './EditorialSplit';

type AboutSectionProps = { content: AboutContent };

export function AboutSection({ content }: AboutSectionProps) {
  return (
    <section id="quienes-somos" className="section-shell bg-surface">
      <EditorialSplit eyebrow="Acerca de Rehabex" title={content.title} description={content.description} imageUrl={content.image} imageAlt={content.title} ctaLabel="Conocer el catálogo" ctaHref="/tienda" />
    </section>
  );
}
