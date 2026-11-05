import { describe, expect, it } from 'vitest';
import { explainDecision, parseUsagePolicyForm, usageBars } from './usage.js';

const resume = new Date('2026-11-05T15:30:00Z');
const fmt = (d: Date) => d.toISOString().slice(11, 16);

describe('explainDecision', () => {
  it('explains an allow with the cap and where it comes from', () => {
    expect(explainDecision({ allow: true, capPct: 50, reason: 'work_hours' }, fmt)).toBe(
      'Running allowed: up to 50% of the five-hour window (work hours).',
    );
    expect(explainDecision({ allow: true, capPct: 100, reason: 'sleeping_hours' }, fmt)).toContain(
      'sleeping hours',
    );
    expect(explainDecision({ allow: true, capPct: 50, reason: 'override_working' }, fmt)).toContain(
      'working mode',
    );
    expect(explainDecision({ allow: true, capPct: 50, reason: 'no_data' }, fmt)).toContain(
      'no usage reading yet',
    );
  });
  it('explains every denial with when it resumes', () => {
    expect(
      explainDecision({ allow: false, reason: 'five_hour_cap', capPct: 50, resumeAt: resume }, fmt),
    ).toBe('Paused: the five-hour cap (50%) is reached. Resumes at 15:30.');
    expect(
      explainDecision({ allow: false, reason: 'weekly_pacing', resumeAt: resume }, fmt),
    ).toContain('ahead of the weekly pace');
    expect(
      explainDecision({ allow: false, reason: 'weekly_ceiling', resumeAt: resume }, fmt),
    ).toContain('weekly ceiling');
    expect(
      explainDecision({ allow: false, reason: 'override_stop', resumeAt: resume }, fmt),
    ).toContain('stop mode');
    expect(explainDecision({ allow: false, reason: 'limit', resumeAt: resume }, fmt)).toContain(
      'plan limit',
    );
    expect(explainDecision({ allow: false, reason: 'limit', resumeAt: null }, fmt)).not.toContain(
      'Resumes at',
    );
  });
});

describe('usageBars', () => {
  const now = new Date('2026-11-05T12:00:00Z');
  it('returns the two windows with percentages and the elapsed share of the week', () => {
    const bars = usageBars(
      {
        fiveHourPct: 35,
        fiveHourResetsAt: new Date('2026-11-05T14:00:00Z'),
        sevenDayPct: 12,
        sevenDayResetsAt: new Date('2026-11-08T12:00:00Z'),
      },
      now,
    );
    expect(bars!.fiveHour).toEqual({ pct: 35, resetsInMinutes: 120 });
    expect(bars!.weekly.pct).toBe(12);
    expect(bars!.weekly.elapsedPct).toBeCloseTo((4 / 7) * 100, 1);
  });
  it('treats a window that already reset as empty', () => {
    const bars = usageBars(
      {
        fiveHourPct: 90,
        fiveHourResetsAt: new Date('2026-11-05T11:00:00Z'),
        sevenDayPct: 95,
        sevenDayResetsAt: new Date('2026-11-05T11:00:00Z'),
      },
      now,
    );
    expect(bars!.fiveHour.pct).toBe(0);
    expect(bars!.weekly.pct).toBe(0);
  });
  it('is null without a snapshot', () => {
    expect(usageBars(null, now)).toBeNull();
  });
});

describe('parseUsagePolicyForm', () => {
  const valid = {
    sleepStart: '00:00',
    sleepEnd: '08:00',
    capWork: '50',
    capSleeping: '100',
    margin: '10',
    ceiling: '90',
  };
  it('maps the form to the stored setting', () => {
    expect(parseUsagePolicyForm(valid)).toEqual({
      ok: true,
      value: {
        sleeping_hours: { start: '00:00', end: '08:00' },
        cap_work_pct: 50,
        cap_sleeping_pct: 100,
        weekly_margin_pct: 10,
        weekly_ceiling_pct: 90,
      },
    });
  });
  it('rejects non-numbers and out-of-range percentages naming the field', () => {
    for (const [field, label] of [
      ['capWork', 'Work cap'],
      ['capSleeping', 'Sleeping cap'],
      ['margin', 'Weekly margin'],
      ['ceiling', 'Weekly ceiling'],
    ] as const) {
      for (const bad of ['', 'abc', '-1', '101']) {
        const r = parseUsagePolicyForm({ ...valid, [field]: bad });
        expect(r.ok, `${field}=${bad}`).toBe(false);
        if (!r.ok) expect(r.error).toContain(label);
      }
    }
  });
  it('rejects malformed sleeping hours', () => {
    expect(parseUsagePolicyForm({ ...valid, sleepStart: '7:00' })).toEqual({
      ok: false,
      error: expect.stringContaining('Sleeping hours start'),
    });
    expect(parseUsagePolicyForm({ ...valid, sleepEnd: '' })).toEqual({
      ok: false,
      error: expect.stringContaining('Sleeping hours end'),
    });
  });
  it('requires the margin to stay below the ceiling', () => {
    expect(parseUsagePolicyForm({ ...valid, margin: '95', ceiling: '90' })).toEqual({
      ok: false,
      error: expect.stringContaining('below'),
    });
  });
});
