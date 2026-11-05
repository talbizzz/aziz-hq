import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { overrideChip } from '../lib/overrides';
import { fetchActiveOverrides } from '../lib/queries';
import { supabase } from '../lib/supabase';
import { Button } from './ui/button';

const KEY = ['overrides'] as const;
const PAUSES = [
  { id: '1h', label: '1 hour', minutes: 60 },
  { id: '4h', label: '4 hours', minutes: 240 },
  { id: '24h', label: '24 hours', minutes: 1440 },
] as const;

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
  const modeMenu = useRef<HTMLDetailsElement>(null);
  const [customCap, setCustomCap] = useState('70');
  const [customMinutes, setCustomMinutes] = useState('120');

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

  const setMode = (kind: 'working' | 'stop' | 'sleeping' | 'custom') => {
    if (modeMenu.current) modeMenu.current.open = false;
    change.mutate(() =>
      supabase.rpc('set_mode_override', {
        p_kind: kind,
        p_minutes: kind === 'custom' ? Number(customMinutes) : undefined,
        p_cap_pct: kind === 'custom' ? Number(customCap) : undefined,
        p_via: 'dashboard',
      }),
    );
  };
  const clearModes = () =>
    change.mutate(async () => {
      for (const kind of ['working', 'sleeping', 'stop', 'custom']) {
        const { error } = await supabase.rpc('clear_override', { p_kind: kind });
        if (error) return { error };
      }
      return { error: null };
    });

  const chip = overrideChip(overrides);
  const modeActive = overrides.some((o) =>
    ['working', 'sleeping', 'stop', 'custom'].includes(o.kind),
  );

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
      <details ref={modeMenu} className="relative">
        <summary className="cursor-pointer rounded-md border px-3 py-1 text-sm hover:bg-accent">
          Mode
        </summary>
        <div className="absolute right-0 z-10 mt-1 flex w-64 flex-col gap-1 rounded-md border bg-background p-2 shadow-md">
          <button
            type="button"
            className="rounded px-2 py-1.5 text-left hover:bg-accent"
            data-testid="mode-working"
            onClick={() => setMode('working')}
          >
            I&apos;m working (5 h)
          </button>
          <button
            type="button"
            className="rounded px-2 py-1.5 text-left hover:bg-accent"
            data-testid="mode-sleeping"
            onClick={() => setMode('sleeping')}
          >
            I&apos;m sleeping (5 h)
          </button>
          <button
            type="button"
            className="rounded px-2 py-1.5 text-left hover:bg-accent"
            data-testid="mode-stop"
            onClick={() => setMode('stop')}
          >
            Stop using my tokens (5 h)
          </button>
          <div className="mt-1 flex items-center gap-1 border-t pt-2">
            <input
              type="number"
              min={0}
              max={100}
              value={customCap}
              onChange={(e) => setCustomCap(e.target.value)}
              className="h-8 w-14 rounded border border-input bg-transparent px-2"
              aria-label="Custom cap in percent"
              data-testid="mode-custom-cap"
            />
            <span>% for</span>
            <input
              type="number"
              min={1}
              max={1440}
              value={customMinutes}
              onChange={(e) => setCustomMinutes(e.target.value)}
              className="h-8 w-16 rounded border border-input bg-transparent px-2"
              aria-label="Custom duration in minutes"
              data-testid="mode-custom-minutes"
            />
            <span>min</span>
            <Button
              size="sm"
              variant="outline"
              data-testid="mode-custom-apply"
              onClick={() => setMode('custom')}
            >
              Set
            </Button>
          </div>
        </div>
      </details>
      {modeActive && (
        <Button variant="outline" size="sm" data-testid="override-clear-modes" onClick={clearModes}>
          Clear mode
        </Button>
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
