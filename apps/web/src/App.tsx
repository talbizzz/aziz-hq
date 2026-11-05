import { Route, Routes } from 'react-router-dom';
import { RouteGuard } from './components/route-guard';
import { DashboardPage } from './pages/dashboard';
import { LoginPage } from './pages/login';
import { MfaPage } from './pages/mfa';

export function App() {
  return (
    <Routes>
      <Route
        path="/login"
        element={
          <RouteGuard>
            <LoginPage />
          </RouteGuard>
        }
      />
      <Route
        path="/mfa"
        element={
          <RouteGuard>
            <MfaPage />
          </RouteGuard>
        }
      />
      <Route
        path="*"
        element={
          <RouteGuard>
            <DashboardPage />
          </RouteGuard>
        }
      />
    </Routes>
  );
}
