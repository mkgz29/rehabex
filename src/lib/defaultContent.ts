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
    image_url: '',
    primary_cta_text: 'Explorar productos',
    primary_cta_link: '#productos',
  },
  about: {
    image: '',
    title: 'Soluciones para acompañar cada etapa de recuperación.',
    description:
      'Somos un equipo enfocado en rehabilitacion y bienestar, con una mirada practica sobre lo que realmente necesita un tratamiento para sostenerse en el tiempo.',
    metrics: [
      { id: 'metric-1', value: '+500', label: 'consultas atendidas con recomendacion personalizada.' },
      { id: 'metric-2', value: '24/7', label: 'foco en continuidad terapeutica y respuesta postventa.' },
    ],
  },
};
