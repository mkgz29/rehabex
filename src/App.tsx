import { Route, Routes } from 'react-router-dom';

import { AdminAboutPage } from './admin/pages/AdminAboutPage';
import { AdminHomePage } from './admin/pages/AdminHomePage';
import { AdminLayout } from './admin/components/AdminLayout';
import { AdminHeroPage } from './admin/pages/AdminHeroPage';
import { AdminProductsPage } from './admin/pages/AdminProductsPage';
import { AppLayout } from './components/AppLayout';
import { CartPage } from './pages/CartPage';
import { LoginPage } from './pages/LoginPage';
import { LandingPage } from './pages/LandingPage';
import { ProductDetailPage } from './pages/ProductDetailPage';
import { ProtectedRoute } from './auth/ProtectedRoute';
import { RegisterPage } from './pages/RegisterPage';
import { StorePage } from './pages/StorePage';

function App() {
  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route path="/" element={<LandingPage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/registro" element={<RegisterPage />} />
        <Route path="/tienda" element={<StorePage />} />
        <Route path="/productos/:id" element={<ProductDetailPage />} />
        <Route path="/carrito" element={<CartPage />} />
        <Route
          path="/admin"
          element={
            <ProtectedRoute requireAdmin>
              <AdminLayout />
            </ProtectedRoute>
          }
        >
          <Route index element={<AdminHomePage />} />
          <Route path="hero" element={<AdminHeroPage />} />
          <Route path="quienes-somos" element={<AdminAboutPage />} />
          <Route path="productos" element={<AdminProductsPage />} />
        </Route>
      </Route>
    </Routes>
  );
}

export default App;
