import {
  usagePolicySettingsSchema,
  type PolicyDecision,
  type UsagePolicySettings,
  type UsageSnapshot,
} from '@aziz-hq/core';

const ALLOW_SOURCE: Record<string, string> = {
  work_hours: 'work hours',
  sleeping_hours: 'sleeping hours',
  override_working: 'working mode',
  override_sleeping: 'sleeping mode',
  override_custom: 'custom mode',
  off_today: 'off today',
  no_data: 'no usage reading yet',
};

const DENY_TEXT: Record<string, (cap?: number) => string> = {
  five_hour_cap: (cap) => `the five-hour cap (${cap}%) is reached`,
  weekly_pacing: () => 'usage is ahead of the weekly pace',
  weekly_ceiling: () => 'the weekly ceiling is reached',
  override_stop: () => 'stop mode is active',
  limit: () => 'the plan limit was hit',
};

/** Plain-language form of a policy decision (what the usage panel shows). */
export function explainDecision(decision: PolicyDecision, format: (d: Date) => string): string {
  if (decision.allow) {
    return `Running allowed: up to ${decision.capPct}% of the five-hour window (${ALLOW_SOURCE[decision.reason] ?? decision.reason}).`;
  }
  const why = (DENY_TEXT[decision.reason] ?? (() => decision.reason))(decision.capPct);
  return `Paused: ${why}.${decision.resumeAt ? ` Resumes at ${format(decision.resumeAt)}.` : ''}`;
}

const WEEK_MS = 7 * 24 * 3_600_000;

export interface UsageBars {
  fiveHour: { pct: number; resetsInMinutes: number };
  weekly: { pct: number; elapsedPct: number; resetsInMinutes: number };
}

/** The numbers behind the two bars; a window that already reset counts as empty. */
export function usageBars(snapshot: UsageSnapshot | null, now: Date): UsageBars | null {
  if (!snapshot) return null;
  const minutes = (d: Date) => Math.max(0, Math.round((d.getTime() - now.getTime()) / 60_000));
  const fiveLive = snapshot.fiveHourResetsAt.getTime() > now.getTime();
  const weekLive = snapshot.sevenDayResetsAt.getTime() > now.getTime();
  return {
    fiveHour: {
      pct: fiveLive ? snapshot.fiveHourPct : 0,
      resetsInMinutes: minutes(snapshot.fiveHourResetsAt),
    },
    weekly: {
      pct: weekLive ? snapshot.sevenDayPct : 0,
      elapsedPct: weekLive
        ? Math.min(
            100,
            Math.max(
              0,
              (1 - (snapshot.sevenDayResetsAt.getTime() - now.getTime()) / WEEK_MS) * 100,
            ),
          )
        : 0,
      resetsInMinutes: minutes(snapshot.sevenDayResetsAt),
    },
  };
}

export interface UsagePolicyForm {
  sleepStart: string;
  sleepEnd: string;
  capWork: string;
  capSleeping: string;
  margin: string;
  ceiling: string;
}

export type UsagePolicyParse =
  { ok: true; value: UsagePolicySettings } | { ok: false; error: string };

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

export function parseUsagePolicyForm(form: UsagePolicyForm): UsagePolicyParse {
  for (const [label, value] of [
    ['Sleeping hours start', form.sleepStart],
    ['Sleeping hours end', form.sleepEnd],
  ] as const) {
    if (!TIME.test(value)) return { ok: false, error: `${label} must be a time like 00:00` };
  }
  const numbers: Record<string, number> = {};
  for (const [key, label, value] of [
    ['capWork', 'Work cap', form.capWork],
    ['capSleeping', 'Sleeping cap', form.capSleeping],
    ['margin', 'Weekly margin', form.margin],
    ['ceiling', 'Weekly ceiling', form.ceiling],
  ] as const) {
    const n = value.trim() === '' ? Number.NaN : Number(value);
    if (!Number.isFinite(n) || n < 0 || n > 100)
      return { ok: false, error: `${label} must be a number from 0 to 100` };
    numbers[key] = n;
  }
  if (numbers.margin! >= numbers.ceiling!)
    return { ok: false, error: 'Weekly margin must be below the weekly ceiling' };

  const parsed = usagePolicySettingsSchema.safeParse({
    sleeping_hours: { start: form.sleepStart, end: form.sleepEnd },
    cap_work_pct: numbers.capWork,
    cap_sleeping_pct: numbers.capSleeping,
    weekly_margin_pct: numbers.margin,
    weekly_ceiling_pct: numbers.ceiling,
  });
  return parsed.success
    ? { ok: true, value: parsed.data }
    : { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid settings' };
}
