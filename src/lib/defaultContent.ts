import type { LandingContent, Product } from '../types/cms';

export const defaultProducts: Product[] = [
  {
    id: 'electroestimulador-pro',
    name: 'Electroestimulador Pro',
    description: 'Equipo compacto para terapias de recuperacion muscular y alivio del dolor.',
    price: 249900,
    imageUrl:
      'https://images.unsplash.com/photo-1582719471384-894fbb16e074?auto=format&fit=crop&w=900&q=80',
    active: true,
  },
  {
    id: 'kit-bandas-terapeuticas',
    name: 'Kit de bandas terapeuticas',
    description: 'Set de resistencia progresiva para rehabilitacion funcional en casa o consultorio.',
    price: 45990,
    imageUrl:
      'https://images.unsplash.com/photo-1517836357463-d25dfeac3438?auto=format&fit=crop&w=900&q=80',
    active: true,
  },
  {
    id: 'camilla-ergonomica',
    name: 'Camilla ergonomica',
    description: 'Superficie estable y confortable para sesiones prolongadas de tratamiento.',
    price: 389000,
    imageUrl:
      'https://images.unsplash.com/photo-1576091160550-2173dba999ef?auto=format&fit=crop&w=900&q=80',
    active: true,
  },
  {
    id: 'rodillo-miofascial',
    name: 'Rodillo miofascial',
    description: 'Apoyo versatil para movilidad, descarga muscular y recuperacion diaria.',
    price: 28990,
    imageUrl:
      'https://images.unsplash.com/photo-1599058917765-a780eda07a3e?auto=format&fit=crop&w=900&q=80',
    active: true,
  },
];

export const defaultLandingContent: LandingContent = {
  hero: {
    badge: 'Soluciones para rehabilitacion profesional',
    title: 'Tecnologia y acompanamiento para cada etapa de recuperacion.',
    subtitle:
      'En REHABEX conectamos profesionales, centros y pacientes con productos confiables para fisioterapia, recuperacion funcional y bienestar diario.',
    image_url:
      'https://images.unsplash.com/photo-1571019614242-c5c5dee9f50b?auto=format&fit=crop&w=1200&q=80',
    primary_cta_text: 'Ver productos destacados',
    primary_cta_link: '#productos',
    secondary_cta_text: 'Conocer REHABEX',
    secondary_cta_link: '#quienes-somos',
  },
  about: {
    image: 'https://images.unsplash.com/photo-1516549655169-df83a0774514?auto=format&fit=crop&w=1200&q=80',
    title: 'REHABEX nace para acercar soluciones utiles, confiables y faciles de implementar',
    description:
      'Somos un equipo enfocado en rehabilitacion y bienestar, con una mirada practica sobre lo que realmente necesita un tratamiento para sostenerse en el tiempo.',
    metrics: [
      { id: 'metric-1', value: '+500', label: 'consultas atendidas con recomendacion personalizada.' },
      { id: 'metric-2', value: '24/7', label: 'foco en continuidad terapeutica y respuesta postventa.' },
    ],
  },
  featuredProductIds: defaultProducts.slice(0, 3).map((product) => product.id),
};
