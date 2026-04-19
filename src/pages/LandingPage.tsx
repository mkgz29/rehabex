import { AboutSection } from '../components/AboutSection';
import { BenefitsSection } from '../components/BenefitsSection';
import { FeaturedProductsSection } from '../components/FeaturedProductsSection';
import { Footer } from '../components/Footer';
import { HeroSection } from '../components/HeroSection';
import { Navbar } from '../components/Navbar';
import { useLandingData } from '../hooks/useLandingData';

export function LandingPage() {
  const { content, products } = useLandingData();
  const featuredProducts = content.featuredProductIds
    .map((productId) => products.find((product) => product.id === productId && product.active))
    .filter((product): product is NonNullable<typeof product> => Boolean(product))
    .slice(0, 3);

  return (
    <div className="min-h-screen overflow-x-hidden bg-stone-50 text-slate-900">
      <Navbar />
      <main>
        <HeroSection slides={content.hero.slides} />
        <FeaturedProductsSection products={featuredProducts} />
        <BenefitsSection />
        <AboutSection content={content.about} />
      </main>
      <Footer />
    </div>
  );
}
