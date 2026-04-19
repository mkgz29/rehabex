export type HeroContent = {
  badge?: string;
  title: string;
  subtitle: string;
  image_url: string;
  primary_cta_text: string;
  primary_cta_link: string;
  secondary_cta_text?: string;
  secondary_cta_link?: string;
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
