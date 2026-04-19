import { Route, Routes } from 'react-router-dom';

import { AdminHeroPage } from './admin/pages/AdminHeroPage';
import { LandingPage } from './pages/LandingPage';

function App() {
  return (
    <Routes>
      <Route path="/" element={<LandingPage />} />
      <Route path="/admin" element={<AdminHeroPage />} />
    </Routes>
  );
}

export default App;
