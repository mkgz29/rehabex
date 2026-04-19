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
    slides: [
      {
        id: 'hero-slide-1',
        image: 'https://images.unsplash.com/photo-1571019614242-c5c5dee9f50b?auto=format&fit=crop&w=1200&q=80',
        alt: 'Profesional de rehabilitacion guiando una sesion terapeutica',
        title: 'Tecnologia y acompanamiento para cada etapa de recuperacion.',
        subtitle:
          'En REHABEX conectamos profesionales, centros y pacientes con productos confiables para fisioterapia, recuperacion funcional y bienestar diario.',
        primaryButtonText: 'Ver productos destacados',
        primaryButtonLink: '#productos',
        secondaryButtonText: 'Conocer REHABEX',
        secondaryButtonLink: '#quienes-somos',
      },
      {
        id: 'hero-slide-2',
        image: 'https://images.unsplash.com/photo-1516549655169-df83a0774514?auto=format&fit=crop&w=1200&q=80',
        alt: 'Espacio clinico preparado para sesiones de rehabilitacion',
        title: 'Productos listos para sostener tratamientos con continuidad y confianza.',
        subtitle:
          'Seleccionamos equipamiento funcional para espacios terapeuticos que necesitan durabilidad, confort y resultados consistentes.',
        primaryButtonText: 'Explorar equipamiento',
        primaryButtonLink: '#productos',
        secondaryButtonText: 'Quienes somos',
        secondaryButtonLink: '#quienes-somos',
      },
      {
        id: 'hero-slide-3',
        image: 'https://images.unsplash.com/photo-1576091160399-112ba8d25d1d?auto=format&fit=crop&w=1200&q=80',
        alt: 'Paciente recibiendo acompanamiento durante una sesion de recuperacion',
        title: 'Asesoria simple para elegir mejor desde el primer contacto.',
        subtitle:
          'Te ayudamos a encontrar la opcion adecuada segun objetivo terapeutico, frecuencia de uso y contexto profesional o domiciliario.',
        primaryButtonText: 'Hablar con un asesor',
        primaryButtonLink: '#contacto',
        secondaryButtonText: 'Ver destacados',
        secondaryButtonLink: '#productos',
      },
    ],
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
