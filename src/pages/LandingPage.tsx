import { AboutSection } from '../components/AboutSection';
import { CommercialFeatureSection } from '../components/CommercialFeatureSection';
import { FeaturedProductsSection } from '../components/FeaturedProductsSection';
import { Footer } from '../components/Footer';
import { HeroSection } from '../components/HeroSection';
import { Reveal } from '../components/Reveal';
import { SupportCtaSection } from '../components/SupportCtaSection';
import { TrustStrip } from '../components/TrustStrip';
import { useLandingData } from '../hooks/useLandingData';
import { isPublicCatalogProduct } from '../lib/catalog';

export function LandingPage() {
  const { content, isLoading, products, productsError, reloadProducts } = useLandingData();
  const activeProducts = [...products]
    .filter(isPublicCatalogProduct)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
  const featuredProducts = [...activeProducts]
    .filter((product) => product.featured)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))
    .slice(0, 4);

  return (
    <div className="min-h-screen bg-canvas text-ink">
      <main id="contenido-principal">
        <HeroSection heroContent={content.hero} isLoading={isLoading} />
        <Reveal><TrustStrip /></Reveal>
        <Reveal><FeaturedProductsSection content={content.featuredSection} products={featuredProducts} isLoading={isLoading} error={productsError} onRetry={reloadProducts} /></Reveal>
        <Reveal><AboutSection content={content.about} products={activeProducts} isLoading={isLoading} /></Reveal>
        {!isLoading && !productsError ? <Reveal><CommercialFeatureSection product={featuredProducts[0]} /></Reveal> : null}
        <Reveal><SupportCtaSection content={content.catalogSection} isLoading={isLoading} /></Reveal>
      </main>
      <Reveal><Footer categories={activeProducts.map((product) => product.category).filter((category): category is string => Boolean(category))} /></Reveal>
    </div>
  );
}
