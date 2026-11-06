import { z } from 'zod';

// ADR-15. A pure decision: how much of the Claude plan the factory may use right now. No I/O, fully deterministic.

const HHMM = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'expected HH:MM');
const pct = z.number().min(0).max(100);

export const usagePolicySettingsSchema = z.object({
  sleeping_hours: z.object({ start: HHMM, end: HHMM }),
  cap_work_pct: pct,
  cap_sleeping_pct: pct,
  weekly_margin_pct: pct,
  weekly_ceiling_pct: pct,
});
export type UsagePolicySettings = z.infer<typeof usagePolicySettingsSchema>;

/** Project-Raw defaults: 100% while sleeping (00:00-08:00), 50% otherwise, pace margin 10, hard ceiling 90. */
export const defaultUsagePolicy: UsagePolicySettings = {
  sleeping_hours: { start: '00:00', end: '08:00' },
  cap_work_pct: 50,
  cap_sleeping_pct: 100,
  weekly_margin_pct: 10,
  weekly_ceiling_pct: 90,
};

export interface UsageSnapshot {
  fiveHourPct: number;
  fiveHourResetsAt: Date;
  sevenDayPct: number;
  sevenDayResetsAt: Date;
}

export interface PolicyOverride {
  kind:
    | 'pause'
    | 'stop'
    | 'working'
    | 'sleeping'
    | 'custom'
    | 'off_today'
    | 'limit'
    /** "Ignore the weekly pacing" until local midnight / until the weekly window resets. */
    | 'pacing_bypass_day'
    | 'pacing_bypass_week';
  /** Only for `custom`. */
  capPct: number | null;
  createdAt: Date;
  expiresAt: Date;
}

export interface PolicyInput {
  now: Date;
  timezone: string;
  settings: UsagePolicySettings;
  /** The latest usage reading, or null before the first one. */
  snapshot: UsageSnapshot | null;
  overrides: PolicyOverride[];
}

export type AllowReason =
  | 'sleeping_hours'
  | 'work_hours'
  | 'override_working'
  | 'override_sleeping'
  | 'override_custom'
  | 'off_today'
  | 'no_data';
export type DenyReason =
  'weekly_ceiling' | 'weekly_pacing' | 'five_hour_cap' | 'override_stop' | 'limit';

export type PolicyDecision =
  | { allow: true; capPct: number; reason: AllowReason }
  | { allow: false; reason: DenyReason; resumeAt: Date | null; capPct?: number };

const WEEK_MS = 7 * 24 * 3_600_000;

function minutesOfDay(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h! * 60 + m!;
}

function localMinutes(date: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(date);
  const get = (type: string) => Number(parts.find((p) => p.type === type)!.value);
  return get('hour') * 60 + get('minute');
}

/** Local-time window, start inclusive and end exclusive; may span midnight (e.g. 22:00-06:00). */
export function isSleepingHours(
  now: Date,
  timeZone: string,
  hours: { start: string; end: string },
): boolean {
  const start = minutesOfDay(hours.start);
  const end = minutesOfDay(hours.end);
  const at = localMinutes(now, timeZone);
  return start <= end ? at >= start && at < end : at >= start || at < end;
}

const MODE_KINDS = new Set<PolicyOverride['kind']>([
  'pause',
  'stop',
  'working',
  'sleeping',
  'custom',
]);

export function evaluateUsagePolicy(input: PolicyInput): PolicyDecision {
  const { now, timezone, settings, snapshot } = input;
  const active = input.overrides.filter((o) => o.expiresAt.getTime() > now.getTime());

  // A window that has already reset is empty: a stale snapshot must never block.
  const fiveHourPct =
    snapshot && snapshot.fiveHourResetsAt.getTime() > now.getTime() ? snapshot.fiveHourPct : 0;
  const sevenDayLive = snapshot !== null && snapshot.sevenDayResetsAt.getTime() > now.getTime();
  const sevenDayPct = sevenDayLive ? snapshot!.sevenDayPct : 0;

  // 1. The weekly hard ceiling always applies, whatever the overrides say.
  if (sevenDayLive && sevenDayPct >= settings.weekly_ceiling_pct) {
    return { allow: false, reason: 'weekly_ceiling', resumeAt: snapshot!.sevenDayResetsAt };
  }

  // 2. A plan limit that was actually hit holds everything until its window resets.
  const limit = active
    .filter((o) => o.kind === 'limit')
    .sort((a, b) => b.expiresAt.getTime() - a.expiresAt.getTime())[0];
  if (limit) return { allow: false, reason: 'limit', resumeAt: limit.expiresAt };

  // 3. The most recently created mode override decides; "off today" is weaker than an explicit mode.
  const mode = active
    .filter((o) => MODE_KINDS.has(o.kind))
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
  const offToday = active.find((o) => o.kind === 'off_today');
  if (mode && (mode.kind === 'stop' || mode.kind === 'pause')) {
    return { allow: false, reason: 'override_stop', resumeAt: mode.expiresAt, capPct: 0 };
  }

  let capPct: number;
  let reason: AllowReason;
  if (mode) {
    capPct =
      mode.kind === 'working'
        ? settings.cap_work_pct
        : mode.kind === 'sleeping'
          ? settings.cap_sleeping_pct
          : (mode.capPct ?? settings.cap_work_pct);
    reason = `override_${mode.kind}` as AllowReason;
  } else if (offToday) {
    capPct = 100;
    reason = 'off_today';
  } else if (isSleepingHours(now, timezone, settings.sleeping_hours)) {
    capPct = settings.cap_sleeping_pct;
    reason = 'sleeping_hours';
  } else {
    capPct = settings.cap_work_pct;
    reason = 'work_hours';
  }

  // 4. Weekly pacing slows everything down, including modes and "off today". Only an explicit pacing bypass
  //    (today or this week) lifts it; the hard ceiling above still applies to the bypass.
  const bypassPacing = active.some(
    (o) => o.kind === 'pacing_bypass_day' || o.kind === 'pacing_bypass_week',
  );
  if (sevenDayLive && !bypassPacing) {
    const elapsedPct =
      Math.min(
        1,
        Math.max(0, 1 - (snapshot!.sevenDayResetsAt.getTime() - now.getTime()) / WEEK_MS),
      ) * 100;
    if (sevenDayPct > elapsedPct + settings.weekly_margin_pct) {
      const catchUpMs = ((sevenDayPct - settings.weekly_margin_pct - elapsedPct) / 100) * WEEK_MS;
      const resumeAt = new Date(
        Math.min(snapshot!.sevenDayResetsAt.getTime(), now.getTime() + catchUpMs),
      );
      return { allow: false, reason: 'weekly_pacing', resumeAt };
    }
  }

  // 5. The five-hour cap; reaching it is already a stop.
  if (snapshot !== null && fiveHourPct >= capPct) {
    return { allow: false, reason: 'five_hour_cap', resumeAt: snapshot.fiveHourResetsAt, capPct };
  }
  return { allow: true, capPct, reason: snapshot === null ? 'no_data' : reason };
}
