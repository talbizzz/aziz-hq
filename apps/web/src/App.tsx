import { Route, Routes } from 'react-router-dom';
import { AppShell } from './components/app-shell';
import { RouteGuard } from './components/route-guard';
import { HomePage } from './pages/home';
import { LoginPage } from './pages/login';
import { MfaPage } from './pages/mfa';
import { RunDetailPage } from './pages/run-detail';
import { RunsPage } from './pages/runs';

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
        element={
          <RouteGuard>
            <AppShell />
          </RouteGuard>
        }
      >
        <Route path="runs" element={<RunsPage />} />
        <Route path="runs/:runId" element={<RunDetailPage />} />
        <Route path="*" element={<HomePage />} />
      </Route>
    </Routes>
  );
}
