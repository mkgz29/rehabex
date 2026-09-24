import { AboutSection } from '../components/AboutSection';
import { CatalogCtaSection } from '../components/CatalogCtaSection';
import { CommercialFeatureSection } from '../components/CommercialFeatureSection';
import { FeaturedProductsSection } from '../components/FeaturedProductsSection';
import { Footer } from '../components/Footer';
import { HeroSection } from '../components/HeroSection';
import { Reveal } from '../components/Reveal';
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
        <Reveal><FeaturedProductsSection products={featuredProducts} isLoading={isLoading} error={productsError} onRetry={reloadProducts} /></Reveal>
        <Reveal><AboutSection content={content.about} products={activeProducts} /></Reveal>
        {!isLoading && !productsError ? <Reveal><CommercialFeatureSection product={featuredProducts[0]} /></Reveal> : null}
        <Reveal><CatalogCtaSection /></Reveal>
      </main>
      <Reveal><Footer categories={activeProducts.map((product) => product.category).filter((category): category is string => Boolean(category))} /></Reveal>
    </div>
  );
}
