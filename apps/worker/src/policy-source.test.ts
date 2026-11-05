import { describe, expect, it, vi } from 'vitest';
import { createPolicyProvider, type PolicyDb } from './policy-source.js';

const now = new Date('2026-11-05T11:00:00Z'); // 12:00 Berlin: work hours
const db = (over: Partial<PolicyDb> = {}): PolicyDb => ({
  latestSnapshot: vi.fn(async () => null),
  activeOverrides: vi.fn(async () => []),
  settings: vi.fn(async () => ({ usagePolicy: undefined, timezone: undefined })),
  ...over,
});

describe('createPolicyProvider', () => {
  it('uses the default policy and the default time zone when settings are missing', async () => {
    const decision = await createPolicyProvider(db(), () => now)();
    expect(decision).toEqual({ allow: true, capPct: 50, reason: 'no_data' });
  });

  it('feeds the snapshot, the overrides and the settings into the engine', async () => {
    const source = db({
      latestSnapshot: vi.fn(async () => ({
        fiveHourPct: 55,
        fiveHourResetsAt: new Date('2026-11-05T13:00:00Z'),
        sevenDayPct: 10,
        sevenDayResetsAt: new Date('2026-11-08T11:00:00Z'),
      })),
    });
    const decision = await createPolicyProvider(source, () => now)();
    expect(decision).toMatchObject({ allow: false, reason: 'five_hour_cap', capPct: 50 });
  });

  it('applies active overrides', async () => {
    const source = db({
      activeOverrides: vi.fn(async () => [
        {
          kind: 'stop' as const,
          capPct: null,
          createdAt: new Date('2026-11-05T10:00:00Z'),
          expiresAt: new Date('2026-11-05T15:00:00Z'),
        },
      ]),
    });
    expect(await createPolicyProvider(source, () => now)()).toMatchObject({
      allow: false,
      reason: 'override_stop',
    });
  });

  it('reads thresholds and the time zone from settings, and falls back to defaults for an invalid value', async () => {
    const custom = db({
      settings: vi.fn(async () => ({
        usagePolicy: {
          sleeping_hours: { start: '10:00', end: '14:00' },
          cap_work_pct: 30,
          cap_sleeping_pct: 100,
          weekly_margin_pct: 10,
          weekly_ceiling_pct: 90,
        },
        timezone: 'Europe/Berlin',
      })),
      latestSnapshot: vi.fn(async () => ({
        fiveHourPct: 80,
        fiveHourResetsAt: new Date('2026-11-05T13:00:00Z'),
        sevenDayPct: 10,
        sevenDayResetsAt: new Date('2026-11-08T11:00:00Z'),
      })),
    });
    expect(await createPolicyProvider(custom, () => now)()).toMatchObject({
      allow: true,
      capPct: 100,
    }); // noon is "sleeping" now
    const broken = db({
      settings: vi.fn(async () => ({
        usagePolicy: { cap_work_pct: 'lots' },
        timezone: 'Mars/Olympus',
      })),
    });
    expect(await createPolicyProvider(broken, () => now)()).toEqual({
      allow: true,
      capPct: 50,
      reason: 'no_data',
    });
  });

  it('propagates database errors so the loop can back off', async () => {
    const failing = db({
      latestSnapshot: vi.fn(async () => {
        throw new Error('db down');
      }),
    });
    await expect(createPolicyProvider(failing, () => now)()).rejects.toThrow('db down');
  });
});
