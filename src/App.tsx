import { Navigate, Route, Routes } from 'react-router-dom';

import { AdminAboutPage } from './admin/pages/AdminAboutPage';
import { AdminLayout } from './admin/components/AdminLayout';
import { AdminHeroPage } from './admin/pages/AdminHeroPage';
import { AdminProductsPage } from './admin/pages/AdminProductsPage';
import { LandingPage } from './pages/LandingPage';

function App() {
  return (
    <Routes>
      <Route path="/" element={<LandingPage />} />
      <Route path="/admin" element={<AdminLayout />}>
        <Route index element={<Navigate to="productos" replace />} />
        <Route path="hero" element={<AdminHeroPage />} />
        <Route path="quienes-somos" element={<AdminAboutPage />} />
        <Route path="productos" element={<AdminProductsPage />} />
        <Route path="destacados" element={<Navigate to="/admin/productos" replace />} />
      </Route>
    </Routes>
  );
}

export default App;
