import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { decideRoute } from '../lib/redirects';

// UX only: the data is protected by RLS + is_owner(), and the requests by the Access middleware.
export function RouteGuard({ children }: { children: ReactNode }) {
  const auth = useAuth();
  const { pathname } = useLocation();
  if (auth.status === 'loading')
    return <p className="p-6 text-sm text-muted-foreground">Loading…</p>;

  const decision = decideRoute({
    accessOk: true,
    session: !!auth.session,
    aal: auth.aal,
    path: pathname,
  });
  if (decision.type === 'redirect') return <Navigate to={decision.to} replace />;
  if (decision.type === 'deny') return <p className="p-6 text-sm">Access denied.</p>;
  return <>{children}</>;
}
