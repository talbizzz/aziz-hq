import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { fetchActiveOverrides } from '../lib/queries';
import { supabase } from '../lib/supabase';
import { Button } from './ui/button';

const KEY = ['overrides'] as const;
const PAUSES = [
  { id: '1h', label: '1 hour', minutes: 60 },
  { id: '4h', label: '4 hours', minutes: 240 },
  { id: '24h', label: '24 hours', minutes: 1440 },
] as const;

// view columns are typed nullable; an active override always has an expiry
const time = (iso: string | null) =>
  iso ? new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';

export function OverrideControls() {
  const queryClient = useQueryClient();
  const menu = useRef<HTMLDetailsElement>(null);
  // refetch every 30 s too: expiry produces no database event
  const { data: overrides = [] } = useQuery({
    queryKey: KEY,
    queryFn: fetchActiveOverrides,
    refetchInterval: 30_000,
  });
  const pause = overrides.find((o) => o.kind === 'pause');
  const off = overrides.find((o) => o.kind === 'off_today');
  // optimistic: the checkbox flips at once and settles when the refetch lands
  const [optimisticOff, setOptimisticOff] = useState<boolean | null>(null);

  const change = useMutation({
    mutationFn: async (run: () => PromiseLike<{ error: { message: string } | null }>) => {
      const { error } = await run();
      if (error) throw new Error(error.message);
    },
    onSettled: async () => {
      await queryClient.invalidateQueries({ queryKey: KEY });
      setOptimisticOff(null);
    },
  });
  const setPause = (minutes: number) => {
    if (menu.current) menu.current.open = false;
    change.mutate(() =>
      supabase.rpc('set_override', { p_kind: 'pause', p_minutes: minutes, p_via: 'dashboard' }),
    );
  };

  const chip = [pause ? `Paused until ${time(pause.expires_at)}` : null, off ? 'Off today' : null]
    .filter(Boolean)
    .join(' · ');

  return (
    <div className="flex items-center gap-3 text-sm">
      {change.isError && (
        <span role="alert" className="text-xs text-destructive" data-testid="override-error">
          {change.error.message}
        </span>
      )}
      {chip && (
        <span
          className="rounded-md bg-accent px-2 py-1 text-xs font-medium"
          data-testid="override-chip"
        >
          {chip}
        </span>
      )}
      {pause ? (
        <Button
          variant="outline"
          size="sm"
          data-testid="override-resume"
          onClick={() => change.mutate(() => supabase.rpc('clear_override', { p_kind: 'pause' }))}
        >
          Resume
        </Button>
      ) : (
        <details ref={menu} className="relative">
          <summary className="cursor-pointer rounded-md border px-3 py-1 text-sm hover:bg-accent">
            Pause
          </summary>
          <div className="absolute right-0 z-10 mt-1 flex w-32 flex-col rounded-md border bg-background p-1 shadow-md">
            {PAUSES.map((p) => (
              <button
                key={p.id}
                type="button"
                className="rounded px-2 py-1.5 text-left hover:bg-accent"
                data-testid={`override-pause-${p.id}`}
                onClick={() => setPause(p.minutes)}
              >
                {p.label}
              </button>
            ))}
          </div>
        </details>
      )}
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={optimisticOff ?? !!off}
          data-testid="off-today-toggle"
          onChange={(e) => {
            setOptimisticOff(e.target.checked);
            change.mutate(() =>
              e.target.checked
                ? supabase.rpc('set_override', { p_kind: 'off_today', p_via: 'dashboard' })
                : supabase.rpc('clear_override', { p_kind: 'off_today' }),
            );
          }}
        />
        I&apos;m off today
      </label>
    </div>
  );
}
