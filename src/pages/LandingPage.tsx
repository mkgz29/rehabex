import { AboutSection } from '../components/AboutSection';
import { CategoriesSection } from '../components/CategoriesSection';
import { CommercialFeatureSection } from '../components/CommercialFeatureSection';
import { FeaturedProductsSection } from '../components/FeaturedProductsSection';
import { Footer } from '../components/Footer';
import { HeroSection } from '../components/HeroSection';
import { NewsletterSection } from '../components/NewsletterSection';
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
    <div className="min-h-screen overflow-x-hidden bg-canvas text-ink">
      <main id="contenido-principal">
        <HeroSection heroContent={content.hero} />
        <TrustStrip />
        <FeaturedProductsSection products={featuredProducts} isLoading={isLoading} error={productsError} onRetry={reloadProducts} />
        {!isLoading && !productsError ? <CategoriesSection products={activeProducts} /> : null}
        <AboutSection content={content.about} />
        {!isLoading && !productsError ? <CommercialFeatureSection product={featuredProducts[0]} /> : null}
        <NewsletterSection />
      </main>
      <Footer />
    </div>
  );
}
