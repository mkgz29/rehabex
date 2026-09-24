import type { LandingContent } from '../types/cms';

export const defaultLandingContent: LandingContent = {
  hero: {
    title: 'Recuperacion con confianza.',
    subtitle: 'Equipamiento y soluciones para rehabilitacion profesional, en un solo lugar.',
    image_url:
      'https://unsplash.com/photos/aqclGN8xdPg/download?force=true&w=1800',
    primary_cta_text: 'Explorar productos',
    primary_cta_link: '#productos',
  },
  about: {
    image: 'https://images.unsplash.com/photo-1516549655169-df83a0774514?auto=format&fit=crop&w=1200&q=80',
    title: 'Soluciones para acompañar cada etapa de recuperación.',
    description:
      'Somos un equipo enfocado en rehabilitacion y bienestar, con una mirada practica sobre lo que realmente necesita un tratamiento para sostenerse en el tiempo.',
    metrics: [
      { id: 'metric-1', value: '+500', label: 'consultas atendidas con recomendacion personalizada.' },
      { id: 'metric-2', value: '24/7', label: 'foco en continuidad terapeutica y respuesta postventa.' },
    ],
  },
};
