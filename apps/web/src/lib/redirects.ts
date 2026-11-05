// Route contract C7 as a pure function. The guard is UX only: RLS + is_owner() protect the data.
export type Aal = 'aal1' | 'aal2';

export interface RouteInput {
  /** A valid Cloudflare Access JWT accompanied the request (enforced by the Pages middleware). */
  accessOk: boolean;
  session: boolean;
  aal: Aal | null;
  path: string;
}

export type RouteDecision = { type: 'next' } | { type: 'redirect'; to: string } | { type: 'deny' };

export function decideRoute({ accessOk, session, aal, path }: RouteInput): RouteDecision {
  if (!accessOk) return { type: 'deny' };

  if (path === '/login') {
    if (!session) return { type: 'next' };
    return { type: 'redirect', to: aal === 'aal2' ? '/' : '/mfa' };
  }

  if (!session) return { type: 'redirect', to: '/login' };

  if (path === '/mfa') {
    return aal === 'aal2' ? { type: 'redirect', to: '/' } : { type: 'next' };
  }

  return aal === 'aal2' ? { type: 'next' } : { type: 'redirect', to: '/mfa' };
}
