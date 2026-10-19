import type { LandingContent } from '../types/cms';

// CMS images (hero.image_url, about.image) never get a default photograph
// here: an editorial stock photo standing in for an unloaded or unconfigured
// image is exactly the bug CMS-UI-01 removes. An empty string is the
// well-defined "no image" state that HeroSection/ImageField render as
// "Imagen no configurada" instead of silently showing stale/wrong art.
export const defaultLandingContent: LandingContent = {
  hero: {
    title: 'Recuperacion con confianza.',
    subtitle: 'Equipamiento y soluciones para rehabilitacion profesional, en un solo lugar.',
    // Same "no hardcoded fallback visible" rule as image_url below: an
    // empty eyebrow renders no line at all rather than a stale placeholder.
    eyebrow: '',
    image_url: '',
    primary_cta_text: 'Explorar productos',
    primary_cta_link: '#productos',
    images: [],
  },
  about: {
    image: '',
    media_type: 'image',
    title: 'Soluciones para acompañar cada etapa de recuperación.',
    description:
      'Somos un equipo enfocado en rehabilitacion y bienestar, con una mirada practica sobre lo que realmente necesita un tratamiento para sostenerse en el tiempo.',
    metrics: [
      { id: 'metric-1', value: '+500', label: 'consultas atendidas con recomendacion personalizada.' },
      { id: 'metric-2', value: '24/7', label: 'foco en continuidad terapeutica y respuesta postventa.' },
    ],
  },
  // Backfill/fallback for the two documents ADMIN-02E introduces: exactly the
  // copy that was hardcoded in FeaturedProductsSection/SupportCtaSection
  // before this phase, so nothing visibly changes until an admin edits it
  // and no document-not-found flash of different text ever appears.
  featuredSection: {
    title: 'Elegidos para acompañar tu recuperación',
    subtitle: 'Conocé una selección del catálogo activo de Rehabex.',
  },
  // Still the catalogSection document (FASE 7C.1 reconverts the public block
  // it backs from a catalog CTA into the Consultas CTA; renaming the
  // settings key itself is out of scope for this phase).
  catalogSection: {
    title: '¿Necesitás ayuda?',
    subtitle: 'Escribinos si tenés dudas sobre un producto, un pedido, un envío o necesitás asesoramiento.',
  },
};
