import type { LandingContent, Product } from '../types/cms';

export const defaultProducts: Product[] = [
  {
    id: 'electroestimulador-pro',
    name: 'Electroestimulador Pro',
    description: 'Equipo compacto para terapias de recuperacion muscular y alivio del dolor.',
    price: 249900,
    imageUrl:
      'https://images.unsplash.com/photo-1582719471384-894fbb16e074?auto=format&fit=crop&w=900&q=80',
    category: 'Electroterapia',
    ctaText: 'Ver producto',
    ctaLink: '#contacto',
    featured: true,
    sortOrder: 1,
    active: true,
  },
  {
    id: 'kit-bandas-terapeuticas',
    name: 'Kit de bandas terapeuticas',
    description: 'Set de resistencia progresiva para rehabilitacion funcional en casa o consultorio.',
    price: 45990,
    imageUrl:
      'https://images.unsplash.com/photo-1517836357463-d25dfeac3438?auto=format&fit=crop&w=900&q=80',
    category: 'Movimiento',
    ctaText: 'Consultar disponibilidad',
    ctaLink: '#contacto',
    featured: true,
    sortOrder: 2,
    active: true,
  },
  {
    id: 'camilla-ergonomica',
    name: 'Camilla ergonomica',
    description: 'Superficie estable y confortable para sesiones prolongadas de tratamiento.',
    price: 389000,
    imageUrl:
      'https://images.unsplash.com/photo-1576091160550-2173dba999ef?auto=format&fit=crop&w=900&q=80',
    category: 'Equipamiento',
    ctaText: 'Ver producto',
    ctaLink: '#contacto',
    featured: true,
    sortOrder: 3,
    active: true,
  },
  {
    id: 'rodillo-miofascial',
    name: 'Rodillo miofascial',
    description: 'Apoyo versatil para movilidad, descarga muscular y recuperacion diaria.',
    price: 28990,
    imageUrl:
      'https://images.unsplash.com/photo-1599058917765-a780eda07a3e?auto=format&fit=crop&w=900&q=80',
    category: 'Recuperacion',
    ctaText: 'Consultar disponibilidad',
    ctaLink: '#contacto',
    featured: true,
    sortOrder: 4,
    active: true,
  },
  {
    id: 'pistola-masaje-terapeutica',
    name: 'Pistola de masaje terapeutica',
    description: 'Percusion controlada para descarga muscular, activacion y recuperacion post tratamiento.',
    price: 67990,
    imageUrl:
      'https://images.unsplash.com/photo-1599901860904-17e6ed7083a0?auto=format&fit=crop&w=900&q=80',
    category: 'Terapia muscular',
    ctaText: 'Ver producto',
    ctaLink: '#contacto',
    featured: true,
    sortOrder: 5,
    active: true,
  },
  {
    id: 'compresa-frio-calor-pro',
    name: 'Compresa frio calor Pro',
    description: 'Solucion reutilizable para manejo termico en procesos de dolor, inflamacion y descarga.',
    price: 18990,
    imageUrl:
      'https://images.unsplash.com/photo-1576671081837-49000212a370?auto=format&fit=crop&w=900&q=80',
    category: 'Criotermia',
    ctaText: 'Consultar disponibilidad',
    ctaLink: '#contacto',
    featured: true,
    sortOrder: 6,
    active: true,
  },
  {
    id: 'tabla-equilibrio-clinica',
    name: 'Tabla de equilibrio clinica',
    description: 'Base estable para ejercicios de propiocepcion, control postural y trabajo funcional progresivo.',
    price: 52990,
    imageUrl:
      'https://images.unsplash.com/photo-1518611012118-696072aa579a?auto=format&fit=crop&w=900&q=80',
    category: 'Propiocepcion',
    ctaText: 'Ver producto',
    ctaLink: '#contacto',
    featured: true,
    sortOrder: 7,
    active: true,
  },
];

export const defaultLandingContent: LandingContent = {
  hero: {
    title: 'Recuperacion con confianza.',
    subtitle: 'Equipamiento y soluciones para rehabilitacion profesional, en un solo lugar.',
    image_url:
      'https://images.unsplash.com/photo-1516549655169-df83a0774514?auto=format&fit=crop&w=1600&q=80',
    primary_cta_text: 'Explorar productos',
    primary_cta_link: '#productos',
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
