export type HeroSlide = {
  id: string;
  image: string;
  alt: string;
  title: string;
  subtitle: string;
  primaryButtonText: string;
  primaryButtonLink: string;
  secondaryButtonText: string;
  secondaryButtonLink: string;
};

export type HeroContent = {
  slides: HeroSlide[];
};

export type AboutMetric = {
  id: string;
  value: string;
  label: string;
};

export type AboutContent = {
  image: string;
  title: string;
  description: string;
  metrics: AboutMetric[];
};

export type Product = {
  id: string;
  name: string;
  description: string;
  price: number;
  imageUrl: string;
  active: boolean;
};

export type LandingContent = {
  hero: HeroContent;
  about: AboutContent;
  featuredProductIds: string[];
};

export type ProductInput = Omit<Product, 'id'> & {
  id?: string;
};
