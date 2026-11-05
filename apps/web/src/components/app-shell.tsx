import { useQuery } from '@tanstack/react-query';
import { NavLink, Outlet } from 'react-router-dom';
import { fetchOpenGateCount } from '../lib/queries';
import { useRealtimeInvalidation } from '../lib/realtime';
import { supabase } from '../lib/supabase';
import { cn } from '../lib/utils';
import { Button } from './ui/button';

// Settings arrives with the overrides UI (T3.8).
const INBOX_TABLES = ['gates', 'tasks'] as const;

export function AppShell() {
  // is_owner() is the real check (ADR-1); the route guard above is only UX.
  const owner = useQuery({
    queryKey: ['is-owner'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('is_owner');
      if (error) throw error;
      return data;
    },
  });

  // one subscription keeps the inbox list, the gate pages and the nav badge fresh
  useRealtimeInvalidation(INBOX_TABLES, ['inbox']);
  const openGates = useQuery({ queryKey: ['inbox', 'count'], queryFn: fetchOpenGateCount });

  // Signing out clears the session; the route guard then sends us to /login.
  const signOut = () => supabase.auth.signOut();

  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex items-center justify-between border-b px-6 py-3">
        <span className="font-semibold">Aziz HQ</span>
        <Button variant="outline" size="sm" onClick={signOut} data-testid="signout">
          Sign out
        </Button>
      </header>
      <div className="flex flex-1">
        <nav className="w-48 border-r p-4" aria-label="Main">
          <ul className="flex flex-col gap-1">
            <li>
              <NavLink
                to="/inbox"
                className={({ isActive }) =>
                  cn(
                    'flex items-center justify-between rounded-md px-3 py-2 text-sm hover:bg-accent',
                    isActive && 'bg-accent font-medium',
                  )
                }
              >
                Inbox
                {(openGates.data ?? 0) > 0 && (
                  <span
                    className="rounded-full bg-primary px-2 text-xs text-primary-foreground"
                    data-testid="inbox-count"
                  >
                    {openGates.data}
                  </span>
                )}
              </NavLink>
            </li>
            <li>
              <NavLink
                to="/runs"
                className={({ isActive }) =>
                  cn(
                    'block rounded-md px-3 py-2 text-sm hover:bg-accent',
                    isActive && 'bg-accent font-medium',
                  )
                }
              >
                Runs
              </NavLink>
            </li>
            <li>
              <button
                disabled
                className="w-full rounded-md px-3 py-2 text-left text-sm text-muted-foreground"
              >
                Settings
              </button>
            </li>
          </ul>
        </nav>
        <main className="min-w-0 flex-1 p-6">
          {owner.isPending && <p className="text-sm text-muted-foreground">Checking access…</p>}
          {owner.isError && (
            <p role="alert" className="text-sm text-destructive">
              Could not check access.
            </p>
          )}
          {owner.data === false && (
            <p className="text-sm" data-testid="not-authorised">
              Not authorised
            </p>
          )}
          {owner.data === true && <Outlet />}
        </main>
      </div>
    </div>
  );
}
