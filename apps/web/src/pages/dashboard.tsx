import { useQuery } from '@tanstack/react-query';
import { Button } from '../components/ui/button';
import { supabase } from '../lib/supabase';

const nav = ['Inbox', 'Runs', 'Settings'];

export function DashboardPage() {
  // is_owner() is the real check (ADR-1); the route guard above is only UX.
  const owner = useQuery({
    queryKey: ['is-owner'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('is_owner');
      if (error) throw error;
      return data;
    },
  });

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
            {nav.map((item) => (
              <li key={item}>
                <button
                  disabled
                  className="w-full rounded-md px-3 py-2 text-left text-sm text-muted-foreground"
                >
                  {item}
                </button>
              </li>
            ))}
          </ul>
        </nav>
        <main className="flex-1 p-6">
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
          {owner.data === true && (
            <p className="text-sm text-muted-foreground" data-testid="dashboard-empty">
              No gates. Nothing running.
            </p>
          )}
        </main>
      </div>
    </div>
  );
}
