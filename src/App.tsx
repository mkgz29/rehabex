import { AboutSection } from './components/AboutSection';
import { BenefitsSection } from './components/BenefitsSection';
import { FeaturedProductsSection } from './components/FeaturedProductsSection';
import { Footer } from './components/Footer';
import { HeroSection } from './components/HeroSection';
import { Navbar } from './components/Navbar';

function App() {
  return (
    <div className="min-h-screen overflow-x-hidden bg-stone-50 text-slate-900">
      <Navbar />
      <main>
        <HeroSection />
        <FeaturedProductsSection />
        <BenefitsSection />
        <AboutSection />
      </main>
      <Footer />
    </div>
  );
}

export default App;
