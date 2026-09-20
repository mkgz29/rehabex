import { AboutSection } from '../components/AboutSection';
import { CommercialFeatureSection } from '../components/CommercialFeatureSection';
import { FeaturedProductsSection } from '../components/FeaturedProductsSection';
import { Footer } from '../components/Footer';
import { HeroSection } from '../components/HeroSection';
import { NewsletterSection } from '../components/NewsletterSection';
import { Reveal } from '../components/Reveal';
import { TrustStrip } from '../components/TrustStrip';
import { useLandingData } from '../hooks/useLandingData';
import { isInternalCategory } from '../lib/catalog';

export function LandingPage() {
  const { content, isLoading, products, productsError, reloadProducts } = useLandingData();
  const activeProducts = [...products]
    .filter((product) => product.active && !isInternalCategory(product.category))
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
  const featuredProducts = [...activeProducts]
    .filter((product) => product.featured)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))
    .slice(0, 4);

  return (
    <div className="min-h-screen bg-canvas text-ink">
      <main id="contenido-principal">
        <HeroSection heroContent={content.hero} />
        <Reveal><TrustStrip /></Reveal>
        <Reveal><FeaturedProductsSection products={featuredProducts} isLoading={isLoading} error={productsError} onRetry={reloadProducts} /></Reveal>
        <Reveal><AboutSection content={content.about} products={activeProducts} /></Reveal>
        {!isLoading && !productsError ? <Reveal><CommercialFeatureSection product={featuredProducts[0]} /></Reveal> : null}
        <Reveal><NewsletterSection /></Reveal>
      </main>
      <Reveal><Footer categories={activeProducts.map((product) => product.category).filter((category): category is string => Boolean(category))} /></Reveal>
    </div>
  );
}
