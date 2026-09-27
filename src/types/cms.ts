export type HeroContent = {
  title: string;
  subtitle?: string;
  image_url: string;
  primary_cta_text: string;
  primary_cta_link: string;
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

export type ProductImage = {
  /** Null for a legacy image carried over from before the gallery existed (RELEASE-ADMIN-02-PREFLIGHT backfill) -- never issued through the signed-upload flow, so it is identified by its URL instead. */
  mediaAssetId: string | null;
  url: string;
  isPrimary: boolean;
  /** Informational only when read back from the server; while editing, array position is the order and this is unused. */
  displayOrder?: number;
};

export type Product = {
  id: string;
  name: string;
  description: string;
  price: number;
  imageUrl: string;
  imageAssetId?: string;
  category?: string;
  featured: boolean;
  sortOrder: number;
  active: boolean;
  createdAt?: string;
  updatedAt?: string;
  stockOnHand?: number;
  /** Ordered gallery (up to 5); imageUrl always mirrors whichever entry isPrimary. Empty for a product with no images. */
  gallery?: ProductImage[];
};

export type LandingContent = {
  hero: HeroContent;
  about: AboutContent;
};

export type ProductInput = Omit<Product, 'id' | 'createdAt' | 'updatedAt'> & {
  id?: string;
};
