import {
  defaultUsagePolicy,
  evaluateUsagePolicy,
  usagePolicySettingsSchema,
  type PolicyOverride,
  type UsageSnapshot,
} from '@aziz-hq/core';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { fetchActiveOverrides, fetchLatestSnapshot, fetchSettings } from '../lib/queries';
import { useRealtimeInvalidation } from '../lib/realtime';
import { explainDecision, usageBars } from '../lib/usage';
import { cn } from '../lib/utils';

const TABLES = ['usage_snapshots'] as const;

function Bar({ pct, marker, className }: { pct: number; marker?: number; className?: string }) {
  return (
    <div className="relative h-2 w-full overflow-hidden rounded-full bg-muted">
      <div
        className={cn('h-full rounded-full bg-primary', className)}
        style={{ width: `${Math.min(100, pct)}%` }}
      />
      {marker !== undefined && (
        <div
          className="absolute top-0 h-full w-0.5 bg-foreground/60"
          style={{ left: `${Math.min(100, marker)}%` }}
        />
      )}
    </div>
  );
}

/** The two plan windows and what the usage policy decides right now (ADR-15), live. */
export function UsagePanel() {
  useRealtimeInvalidation(TABLES, ['usage']);
  const snapshotQuery = useQuery({
    queryKey: ['usage', 'snapshot'],
    queryFn: fetchLatestSnapshot,
    refetchInterval: 30_000,
  });
  const overridesQuery = useQuery({
    queryKey: ['overrides'],
    queryFn: fetchActiveOverrides,
    refetchInterval: 30_000,
  });
  const settingsQuery = useQuery({ queryKey: ['settings'], queryFn: fetchSettings });

  // re-evaluate as time passes (caps depend on the clock)
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(timer);
  }, []);

  const snapshot: UsageSnapshot | null = useMemo(() => {
    const r = snapshotQuery.data;
    return r
      ? {
          fiveHourPct: Number(r.five_hour_pct),
          fiveHourResetsAt: new Date(r.five_hour_resets_at),
          sevenDayPct: Number(r.seven_day_pct),
          sevenDayResetsAt: new Date(r.seven_day_resets_at),
        }
      : null;
  }, [snapshotQuery.data]);

  const decision = useMemo(() => {
    const rows = settingsQuery.data ?? [];
    const policy = usagePolicySettingsSchema.safeParse(
      rows.find((r) => r.key === 'usage_policy')?.value,
    );
    const tz = rows.find((r) => r.key === 'timezone')?.value;
    const overrides: PolicyOverride[] = (overridesQuery.data ?? []).map((o) => ({
      kind: o.kind as PolicyOverride['kind'],
      capPct: o.cap_pct,
      createdAt: new Date(o.created_at ?? now),
      expiresAt: new Date(o.expires_at ?? now),
    }));
    return evaluateUsagePolicy({
      now,
      timezone: typeof tz === 'string' && tz !== '' ? tz : 'Europe/Berlin',
      settings: policy.success ? policy.data : defaultUsagePolicy,
      snapshot,
      overrides,
    });
  }, [settingsQuery.data, overridesQuery.data, snapshot, now]);

  const bars = usageBars(snapshot, now);
  const time = (d: Date) => d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  return (
    <section
      className="flex max-w-xl flex-col gap-4 rounded-lg border p-4"
      data-testid="usage-panel"
      aria-label="Plan usage"
    >
      <h2 className="text-sm font-semibold">Plan usage</h2>
      {bars ? (
        <>
          <div className="flex flex-col gap-1" data-testid="usage-five-hour">
            <div className="flex justify-between text-sm">
              <span>Five-hour window</span>
              <span>
                {bars.fiveHour.pct}% · resets in {bars.fiveHour.resetsInMinutes} min
              </span>
            </div>
            <Bar
              pct={bars.fiveHour.pct}
              marker={decision.allow ? decision.capPct : decision.capPct}
            />
          </div>
          <div className="flex flex-col gap-1" data-testid="usage-weekly">
            <div className="flex justify-between text-sm">
              <span>Weekly</span>
              <span>
                {bars.weekly.pct}% · week {Math.round(bars.weekly.elapsedPct)}% elapsed
              </span>
            </div>
            <Bar pct={bars.weekly.pct} marker={bars.weekly.elapsedPct} />
          </div>
        </>
      ) : (
        <p className="text-sm text-muted-foreground">
          No usage reading yet. The first agent run records one.
        </p>
      )}
      <p className="text-sm" data-testid="usage-decision" data-allow={decision.allow}>
        {explainDecision(decision, time)}
      </p>
    </section>
  );
}
