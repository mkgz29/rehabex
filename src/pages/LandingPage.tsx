import { AboutSection } from '../components/AboutSection';
import { FeaturedProductsSection } from '../components/FeaturedProductsSection';
import { Footer } from '../components/Footer';
import { HeroSection } from '../components/HeroSection';
import { Navbar } from '../components/Navbar';
import { WhatsAppFloatingButton } from '../components/WhatsAppFloatingButton';
import { useLandingData } from '../hooks/useLandingData';

export function LandingPage() {
  const { content, products } = useLandingData();
  const featuredProducts = [...products]
    .filter((product) => product.active && product.featured)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))
    .slice(0, 8);

  return (
    <div className="min-h-screen overflow-x-hidden bg-white text-slate-900">
      <Navbar />
      <main>
        <HeroSection heroContent={content.hero} />
        <FeaturedProductsSection products={featuredProducts} />
        <AboutSection content={content.about} />
      </main>
      <Footer />
      <WhatsAppFloatingButton />
    </div>
  );
}
