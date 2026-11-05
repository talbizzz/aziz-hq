import type { Session } from '@supabase/supabase-js';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Aal } from './redirects';
import { supabase } from './supabase';

export type AuthState =
  { status: 'loading' } | { status: 'ready'; session: Session | null; aal: Aal | null };

const AuthContext = createContext<AuthState>({ status: 'loading' });

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    const read = async () => {
      const { data } = await supabase.auth.getSession();
      let aal: Aal | null = null;
      if (data.session) {
        const level = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
        aal = level.data?.currentLevel === 'aal2' ? 'aal2' : 'aal1';
      }
      if (!cancelled) setState({ status: 'ready', session: data.session, aal });
    };
    void read();
    const { data: sub } = supabase.auth.onAuthStateChange(() => void read());
    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, []);

  return <AuthContext.Provider value={state}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);
