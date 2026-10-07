import { Navigate, Route, Routes } from 'react-router-dom';

import { AdminEditPagePage } from './admin/pages/AdminEditPagePage';
import { AdminHomePage } from './admin/pages/AdminHomePage';
import { AdminLayout } from './admin/components/AdminLayout';
import { AdminOrdersPage } from './admin/pages/AdminOrdersPage';
import { AdminProductsPage } from './admin/pages/AdminProductsPage';
import { LEGACY_ADMIN_REDIRECTS } from './admin/legacyRedirects';
import { AppLayout } from './components/AppLayout';
import { CartPage } from './pages/CartPage';
import { FailurePage } from './pages/FailurePage';
import { LoginPage } from './pages/LoginPage';
import { LandingPage } from './pages/LandingPage';
import { PendingPage } from './pages/PendingPage';
import { ProductDetailPage } from './pages/ProductDetailPage';
import { ProtectedRoute } from './auth/ProtectedRoute';
import { StorePage } from './pages/StorePage';
import { SuccessPage } from './pages/SuccessPage';

function App() {
  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route path="/" element={<LandingPage />} />
        <Route path="/login" element={<LoginPage />} />
        {/* Self-registration is deliberately disabled: there is no customer-account
            feature using it today, and /admin accounts are provisioned in a
            controlled way. RegisterPage itself is kept, unlinked, for reuse once a
            real customer-account feature exists. */}
        <Route path="/registro" element={<Navigate to="/login" replace />} />
        <Route path="/tienda" element={<StorePage />} />
        <Route path="/productos/:id" element={<ProductDetailPage />} />
        <Route path="/carrito" element={<CartPage />} />
        <Route path="/success" element={<SuccessPage />} />
        <Route path="/failure" element={<FailurePage />} />
        <Route path="/pending" element={<PendingPage />} />
        <Route
          path="/admin"
          element={
            <ProtectedRoute requireAdmin>
              <AdminLayout />
            </ProtectedRoute>
          }
        >
          <Route index element={<AdminHomePage />} />
          <Route path="pagina" element={<AdminEditPagePage />} />
          <Route path="productos" element={<AdminProductsPage />} />
          <Route path="pedidos" element={<AdminOrdersPage />} />
          {Object.entries(LEGACY_ADMIN_REDIRECTS).map(([path, to]) => (
            <Route key={path} path={path} element={<Navigate to={to} replace />} />
          ))}
        </Route>
      </Route>
    </Routes>
  );
}

export default App;
