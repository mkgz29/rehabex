import type { ImageFraming } from '../lib/imageFraming';

export type HeroContent = {
  title: string;
  subtitle?: string;
  /** The small uppercase line above the title ("Rehabilitación · Movilidad · Bienestar"). Empty string renders no eyebrow line at all. */
  eyebrow: string;
  image_url: string;
  /** How image_url is positioned in the portada frame. Optional on read for older documents; always normalized to a full value before use. */
  image_framing?: ImageFraming;
  primary_cta_text: string;
  primary_cta_link: string;
  /** The hero carousel's slides, fetched separately from hero_images (not part of the hero_content settings document) and attached here by getLandingContent. */
  images: HeroImage[];
};

export type HeroImage = {
  mediaAssetId: string | null;
  url: string;
  alt: string;
  enabled: boolean;
  displayOrder: number;
  /** How this slide is positioned in the Hero frame. Optional on read for older documents; always normalized to a full value before use, same convention as ProductImage.framing. */
  framing?: ImageFraming;
};

export type AboutMetric = {
  id: string;
  value: string;
  label: string;
};

export type AboutContent = {
  image: string;
  image_framing?: ImageFraming;
  title: string;
  description: string;
  metrics: AboutMetric[];
};

/** Editable copy for the public "Productos destacados" section (ADMIN-02E). */
export type FeaturedSectionContent = {
  title: string;
  subtitle: string;
};

/** Editable copy for the public "Catálogo Rehabex" call-to-action section (ADMIN-02E). */
export type CatalogSectionContent = {
  title: string;
  subtitle: string;
};

export type ProductImage = {
  /** Null for a legacy image carried over from before the gallery existed (RELEASE-ADMIN-02-PREFLIGHT backfill) -- never issued through the signed-upload flow, so it is identified by its URL instead. */
  mediaAssetId: string | null;
  url: string;
  isPrimary: boolean;
  /** How this image is positioned wherever it is shown (product card, detail). Belongs to this gallery slot, not to the file. */
  framing?: ImageFraming;
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
  featuredSection: FeaturedSectionContent;
  catalogSection: CatalogSectionContent;
};

export type ProductInput = Omit<Product, 'id' | 'createdAt' | 'updatedAt'> & {
  id?: string;
};
