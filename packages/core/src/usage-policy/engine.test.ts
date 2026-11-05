import { describe, expect, it } from 'vitest';
import {
  defaultUsagePolicy,
  evaluateUsagePolicy,
  isSleepingHours,
  type PolicyInput,
  type PolicyOverride,
  type UsageSnapshot,
} from './engine.js';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;
const TZ = 'Europe/Berlin';
// 2026-11-05 is CET (UTC+1): 02:00Z = 03:00 local (sleeping), 11:00Z = 12:00 local (work)
const NIGHT = new Date('2026-11-05T02:00:00Z');
const NOON = new Date('2026-11-05T11:00:00Z');

const snap = (over: Partial<UsageSnapshot> = {}, now: Date = NOON): UsageSnapshot => ({
  fiveHourPct: 10,
  fiveHourResetsAt: new Date(now.getTime() + 2 * HOUR),
  sevenDayPct: 10,
  sevenDayResetsAt: new Date(now.getTime() + 3.5 * DAY), // halfway through the week: elapsed 50%
  ...over,
});
const input = (now: Date, over: Partial<PolicyInput> = {}): PolicyInput => ({
  now,
  timezone: TZ,
  settings: defaultUsagePolicy,
  snapshot: snap({}, now),
  overrides: [],
  ...over,
});
const override = (
  kind: PolicyOverride['kind'],
  now: Date,
  over: Partial<PolicyOverride> = {},
): PolicyOverride => ({
  kind,
  capPct: null,
  createdAt: new Date(now.getTime() - HOUR),
  expiresAt: new Date(now.getTime() + 4 * HOUR),
  ...over,
});

describe('isSleepingHours', () => {
  const hours = { start: '00:00', end: '08:00' };
  it('is start-inclusive and end-exclusive in local time', () => {
    expect(isSleepingHours(new Date('2026-11-04T23:00:00Z'), TZ, hours)).toBe(true); // 00:00 local
    expect(isSleepingHours(new Date('2026-11-04T22:59:00Z'), TZ, hours)).toBe(false); // 23:59 local
    expect(isSleepingHours(new Date('2026-11-05T06:59:00Z'), TZ, hours)).toBe(true); // 07:59 local
    expect(isSleepingHours(new Date('2026-11-05T07:00:00Z'), TZ, hours)).toBe(false); // 08:00 local
  });
  it('supports a window spanning midnight', () => {
    const span = { start: '22:00', end: '06:00' };
    expect(isSleepingHours(new Date('2026-11-05T21:00:00Z'), TZ, span)).toBe(true); // 22:00
    expect(isSleepingHours(new Date('2026-11-05T04:59:00Z'), TZ, span)).toBe(true); // 05:59
    expect(isSleepingHours(new Date('2026-11-05T05:00:00Z'), TZ, span)).toBe(false); // 06:00
    expect(isSleepingHours(new Date('2026-11-05T20:59:00Z'), TZ, span)).toBe(false); // 21:59
  });
  it('follows the local clock across a DST changeover', () => {
    expect(isSleepingHours(new Date('2026-03-29T05:59:00Z'), TZ, hours)).toBe(true); // 07:59 CEST
    expect(isSleepingHours(new Date('2026-03-29T06:00:00Z'), TZ, hours)).toBe(false); // 08:00 CEST
    expect(isSleepingHours(new Date('2026-03-28T22:30:00Z'), TZ, hours)).toBe(false); // 23:30 CET the evening before
  });
});

describe('the five-hour cap by time of day', () => {
  it('allows up to 100% while sleeping and denies at 100%', () => {
    expect(
      evaluateUsagePolicy(input(NIGHT, { snapshot: snap({ fiveHourPct: 99.9 }, NIGHT) })),
    ).toMatchObject({ allow: true, capPct: 100 });
    const denied = evaluateUsagePolicy(
      input(NIGHT, { snapshot: snap({ fiveHourPct: 100 }, NIGHT) }),
    );
    expect(denied).toMatchObject({ allow: false, reason: 'five_hour_cap', capPct: 100 });
    expect(denied.allow === false && denied.resumeAt).toEqual(new Date(NIGHT.getTime() + 2 * HOUR));
  });
  it('caps at 50% in work hours, the cap itself is already a stop', () => {
    expect(
      evaluateUsagePolicy(input(NOON, { snapshot: snap({ fiveHourPct: 49.9 }) })),
    ).toMatchObject({ allow: true, capPct: 50 });
    expect(evaluateUsagePolicy(input(NOON, { snapshot: snap({ fiveHourPct: 50 }) }))).toMatchObject(
      { allow: false, reason: 'five_hour_cap', capPct: 50 },
    );
  });
  it('uses the work cap at 08:00 sharp and the sleeping cap at 07:59', () => {
    const at = (iso: string) =>
      evaluateUsagePolicy(
        input(new Date(iso), { snapshot: snap({ fiveHourPct: 70 }, new Date(iso)) }),
      );
    expect(at('2026-11-05T06:59:00Z')).toMatchObject({ allow: true, capPct: 100 });
    expect(at('2026-11-05T07:00:00Z')).toMatchObject({ allow: false, capPct: 50 });
  });
  it('reads every threshold from settings', () => {
    const settings = {
      ...defaultUsagePolicy,
      cap_work_pct: 30,
      sleeping_hours: { start: '10:00', end: '14:00' },
    };
    expect(
      evaluateUsagePolicy(input(NOON, { settings, snapshot: snap({ fiveHourPct: 80 }) })),
    ).toMatchObject({ allow: true, capPct: 100 }); // noon is now "sleeping"
    expect(
      evaluateUsagePolicy(input(NIGHT, { settings, snapshot: snap({ fiveHourPct: 30 }, NIGHT) })),
    ).toMatchObject({ allow: false, capPct: 30 });
  });
});

describe('the weekly hard ceiling and pacing', () => {
  it('denies at the ceiling until the week resets, even with a generous override', () => {
    const snapshot = snap({ sevenDayPct: 90 });
    for (const o of [
      [],
      [override('sleeping', NOON)],
      [override('off_today', NOON)],
      [override('working', NOON)],
    ]) {
      const d = evaluateUsagePolicy(input(NOON, { snapshot, overrides: o }));
      expect(d).toMatchObject({ allow: false, reason: 'weekly_ceiling' });
      expect(d.allow === false && d.resumeAt).toEqual(snapshot.sevenDayResetsAt);
    }
    expect(
      evaluateUsagePolicy(
        input(NOON, {
          snapshot: snap({ sevenDayPct: 89.9, fiveHourPct: 0 }, NOON),
          overrides: [override('sleeping', NOON)],
        }),
      ).allow,
    ).toBe(true);
  });

  it('paces against the time left until resets_at, not the calendar week', () => {
    // 3.5 days left = 50% of the week elapsed, margin 10 => up to 60% is fine
    expect(
      evaluateUsagePolicy(input(NOON, { snapshot: snap({ sevenDayPct: 60, fiveHourPct: 0 }) }))
        .allow,
    ).toBe(true);
    expect(
      evaluateUsagePolicy(input(NOON, { snapshot: snap({ sevenDayPct: 60.1, fiveHourPct: 0 }) })),
    ).toMatchObject({ allow: false, reason: 'weekly_pacing' });
    // only 1 day left = 85.7% elapsed => 40% used is far below the pace
    const late = snap({
      sevenDayPct: 40,
      sevenDayResetsAt: new Date(NOON.getTime() + DAY),
      fiveHourPct: 0,
    });
    expect(evaluateUsagePolicy(input(NOON, { snapshot: late })).allow).toBe(true);
    // a week that has only just started allows almost nothing
    const early = snap({
      sevenDayPct: 15,
      sevenDayResetsAt: new Date(NOON.getTime() + WEEK - HOUR),
      fiveHourPct: 0,
    });
    expect(evaluateUsagePolicy(input(NOON, { snapshot: early }))).toMatchObject({
      allow: false,
      reason: 'weekly_pacing',
    });
  });

  it('tells when the pace catches up, never later than the reset', () => {
    // 3.5 days left (50% elapsed), used 70%: needs elapsed 60% => 10% of a week = 16.8 h later
    const d = evaluateUsagePolicy(
      input(NOON, { snapshot: snap({ sevenDayPct: 70, fiveHourPct: 0 }) }),
    );
    expect(d.allow === false && d.resumeAt).toEqual(new Date(NOON.getTime() + 0.1 * WEEK));
    // when catching up would take longer than the week, resume at the reset
    const far = snap({
      sevenDayPct: 85,
      sevenDayResetsAt: new Date(NOON.getTime() + 2 * HOUR),
      fiveHourPct: 0,
    });
    // 2 h left is ~98.8% elapsed => 85% is within the pace, so this is allowed
    expect(evaluateUsagePolicy(input(NOON, { snapshot: far })).allow).toBe(true);
    const slow = snap({
      sevenDayPct: 89,
      sevenDayResetsAt: new Date(NOON.getTime() + 6.9 * DAY),
      fiveHourPct: 0,
    });
    const denied = evaluateUsagePolicy(input(NOON, { snapshot: slow }));
    expect(denied.allow === false && denied.resumeAt!.getTime()).toBeLessThanOrEqual(
      slow.sevenDayResetsAt.getTime(),
    );
  });

  it('explicit overrides bypass pacing (only the hard ceiling always applies); stop still denies', () => {
    const snapshot = snap({ sevenDayPct: 70, fiveHourPct: 0 }); // above the pace, below the ceiling
    expect(evaluateUsagePolicy(input(NOON, { snapshot }))).toMatchObject({
      allow: false,
      reason: 'weekly_pacing',
    });
    for (const o of [
      override('working', NOON),
      override('sleeping', NOON),
      override('off_today', NOON),
      override('custom', NOON, { capPct: 80 }),
    ]) {
      expect(evaluateUsagePolicy(input(NOON, { snapshot, overrides: [o] })).allow, o.kind).toBe(
        true,
      );
    }
    expect(
      evaluateUsagePolicy(input(NOON, { snapshot, overrides: [override('stop', NOON)] })),
    ).toMatchObject({ allow: false, reason: 'override_stop' });
  });

  it('thresholds come from settings', () => {
    const settings = { ...defaultUsagePolicy, weekly_margin_pct: 0, weekly_ceiling_pct: 55 };
    expect(
      evaluateUsagePolicy(
        input(NOON, { settings, snapshot: snap({ sevenDayPct: 55, fiveHourPct: 0 }) }),
      ),
    ).toMatchObject({ allow: false, reason: 'weekly_ceiling' });
    expect(
      evaluateUsagePolicy(
        input(NOON, { settings, snapshot: snap({ sevenDayPct: 50.5, fiveHourPct: 0 }) }),
      ),
    ).toMatchObject({ allow: false, reason: 'weekly_pacing' });
  });
});

describe('overrides', () => {
  const at = (kinds: PolicyOverride[], pct = 60, now = NOON) =>
    evaluateUsagePolicy(
      input(now, { snapshot: snap({ fiveHourPct: pct, sevenDayPct: 10 }, now), overrides: kinds }),
    );

  it('"I\'m working" caps at the work cap even in sleeping hours', () => {
    expect(at([override('working', NIGHT)], 49, NIGHT)).toMatchObject({ allow: true, capPct: 50 });
    expect(at([override('working', NIGHT)], 50, NIGHT)).toMatchObject({ allow: false, capPct: 50 });
  });
  it('"I\'m sleeping" allows 100% in the middle of the day', () => {
    expect(at([override('sleeping', NOON)], 90)).toMatchObject({ allow: true, capPct: 100 });
  });
  it('a custom override uses its own cap', () => {
    expect(at([override('custom', NOON, { capPct: 70 })], 69)).toMatchObject({
      allow: true,
      capPct: 70,
    });
    expect(at([override('custom', NOON, { capPct: 70 })], 70)).toMatchObject({
      allow: false,
      capPct: 70,
    });
  });
  it('stop and pause deny until the override expires', () => {
    for (const kind of ['stop', 'pause'] as const) {
      const o = override(kind, NOON);
      const d = at([o], 0);
      expect(d).toMatchObject({ allow: false, reason: 'override_stop' });
      expect(d.allow === false && d.resumeAt).toEqual(o.expiresAt);
    }
  });
  it('the most recently created mode override wins', () => {
    const stop = override('stop', NOON, { createdAt: new Date(NOON.getTime() - 2 * HOUR) });
    const working = override('working', NOON, { createdAt: new Date(NOON.getTime() - HOUR) });
    expect(at([stop, working], 10)).toMatchObject({ allow: true, capPct: 50 });
    expect(
      at([working, { ...stop, createdAt: new Date(NOON.getTime() - 30 * 60_000) }], 10),
    ).toMatchObject({ allow: false, reason: 'override_stop' });
  });
  it('"off today" allows 100% in work hours but yields to an explicit mode', () => {
    expect(at([override('off_today', NOON)], 90)).toMatchObject({ allow: true, capPct: 100 });
    expect(at([override('off_today', NOON), override('working', NOON)], 60)).toMatchObject({
      allow: false,
      capPct: 50,
    });
  });
  it('ignores expired overrides', () => {
    const expired = override('stop', NOON, { expiresAt: new Date(NOON.getTime() - 1) });
    expect(at([expired], 10)).toMatchObject({ allow: true, capPct: 50 });
  });
  it('a limit override denies until it expires, regardless of anything else', () => {
    const limit = override('limit', NOON, { expiresAt: new Date(NOON.getTime() + 90 * 60_000) });
    const d = at([limit, override('sleeping', NOON)], 0);
    expect(d).toMatchObject({ allow: false, reason: 'limit' });
    expect(d.allow === false && d.resumeAt).toEqual(limit.expiresAt);
    expect(at([{ ...limit, expiresAt: new Date(NOON.getTime() - 1) }], 0).allow).toBe(true);
  });
});

describe('snapshots', () => {
  it('allows with the effective cap but flags missing data', () => {
    expect(evaluateUsagePolicy(input(NOON, { snapshot: null }))).toEqual({
      allow: true,
      capPct: 50,
      reason: 'no_data',
    });
    expect(evaluateUsagePolicy(input(NIGHT, { snapshot: null }))).toEqual({
      allow: true,
      capPct: 100,
      reason: 'no_data',
    });
  });
  it('treats a window that already reset as empty (a stale snapshot must not block)', () => {
    const stale = snap({
      fiveHourPct: 100,
      fiveHourResetsAt: new Date(NOON.getTime() - 1),
      sevenDayPct: 95,
      sevenDayResetsAt: new Date(NOON.getTime() - 1),
    });
    expect(evaluateUsagePolicy(input(NOON, { snapshot: stale })).allow).toBe(true);
  });
  it('still stops an explicit stop with no data', () => {
    expect(
      evaluateUsagePolicy(input(NOON, { snapshot: null, overrides: [override('stop', NOON)] })),
    ).toMatchObject({ allow: false, reason: 'override_stop' });
  });
});

describe('allow reasons', () => {
  it('names where the cap came from', () => {
    expect(evaluateUsagePolicy(input(NOON))).toMatchObject({ allow: true, reason: 'work_hours' });
    expect(evaluateUsagePolicy(input(NIGHT, { snapshot: snap({}, NIGHT) }))).toMatchObject({
      allow: true,
      reason: 'sleeping_hours',
    });
    expect(
      evaluateUsagePolicy(input(NOON, { overrides: [override('working', NOON)] })),
    ).toMatchObject({ allow: true, reason: 'override_working' });
    expect(
      evaluateUsagePolicy(input(NOON, { overrides: [override('off_today', NOON)] })),
    ).toMatchObject({ allow: true, reason: 'off_today' });
  });
});

// Small seeded PRNG so failures are reproducible.
const rng = (seed: number) => () => {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
};

describe('monotonicity (property)', () => {
  it('raising usage never turns a deny into an allow', () => {
    for (let seed = 1; seed <= 300; seed++) {
      const rand = rng(seed);
      const now = new Date(NOON.getTime() + Math.floor(rand() * 7 * DAY));
      const kinds: PolicyOverride['kind'][] = [
        'pause',
        'stop',
        'working',
        'sleeping',
        'custom',
        'off_today',
        'limit',
      ];
      const overrides = kinds
        .filter(() => rand() < 0.3)
        .map((k) => override(k, now, { capPct: k === 'custom' ? Math.floor(rand() * 101) : null }));
      const base = { fiveHourPct: rand() * 100, sevenDayPct: rand() * 100 };
      const evalWith = (five: number, seven: number) =>
        evaluateUsagePolicy(
          input(now, {
            overrides,
            snapshot: snap(
              {
                fiveHourPct: five,
                sevenDayPct: seven,
                sevenDayResetsAt: new Date(
                  now.getTime() + (0.1 + rand() * 0.9) * WEEK * 0 + 3 * DAY,
                ),
              },
              now,
            ),
          }),
        ).allow;
      const lowFive = evalWith(base.fiveHourPct, base.sevenDayPct);
      const highFive = evalWith(Math.min(100, base.fiveHourPct + rand() * 50), base.sevenDayPct);
      if (!lowFive) expect(highFive, `five-hour, seed ${seed}`).toBe(false);
      const lowSeven = evalWith(base.fiveHourPct, base.sevenDayPct);
      const highSeven = evalWith(base.fiveHourPct, Math.min(100, base.sevenDayPct + rand() * 50));
      if (!lowSeven) expect(highSeven, `seven-day, seed ${seed}`).toBe(false);
    }
  });
});
