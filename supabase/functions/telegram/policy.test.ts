import { describe, expect, it } from 'vitest';
import { decideDelivery, type DeliveryContext, type PolicyNotification } from './policy.js';

const n = (
  priority: 0 | 1 | 2,
  kind: PolicyNotification['kind'] = 'gate_open',
): PolicyNotification => ({ kind, priority });
const ctx = (iso: string, over: Partial<DeliveryContext> = {}): DeliveryContext => ({
  now: new Date(iso),
  timezone: 'Europe/Berlin',
  quietHours: { start: '22:00', end: '07:00' },
  offToday: false,
  offlineAlertSent: true,
  ...over,
});
// 2026-11-05 is CET (UTC+1): 12:00Z = 13:00 local, 22:30Z = 23:30 local, 02:00Z = 03:00 local
const DAY = '2026-11-05T12:00:00Z';
const LATE = '2026-11-05T22:30:00Z';
const EARLY = '2026-11-06T02:00:00Z';

describe('decideDelivery', () => {
  it('sends critical notifications at any time, even off today', () => {
    for (const t of [DAY, LATE, EARLY])
      expect(decideDelivery(n(2), ctx(t, { offToday: true }))).toEqual({ action: 'send' });
  });

  it('sends normal notifications outside quiet hours', () => {
    expect(decideDelivery(n(1), ctx(DAY))).toEqual({ action: 'send' });
  });

  it('defers normal notifications in quiet hours to the end of quiet hours', () => {
    expect(decideDelivery(n(1), ctx(LATE))).toEqual({
      action: 'defer',
      until: new Date('2026-11-06T06:00:00Z'),
    }); // 23:30 -> 07:00 next day
    expect(decideDelivery(n(1), ctx(EARLY))).toEqual({
      action: 'defer',
      until: new Date('2026-11-06T06:00:00Z'),
    }); // 03:00 -> 07:00 same day
  });

  it('treats the quiet window as start-inclusive and end-exclusive', () => {
    expect(decideDelivery(n(1), ctx('2026-11-05T21:00:00Z'))).toMatchObject({ action: 'defer' }); // exactly 22:00 local
    expect(decideDelivery(n(1), ctx('2026-11-06T06:00:00Z'))).toEqual({ action: 'send' }); // exactly 07:00 local
    expect(decideDelivery(n(1), ctx('2026-11-05T20:59:00Z'))).toEqual({ action: 'send' }); // 21:59 local
  });

  it('supports a quiet window inside one day', () => {
    const quiet = { quietHours: { start: '13:00', end: '15:00' } };
    expect(decideDelivery(n(1), ctx('2026-11-05T12:30:00Z', quiet))).toEqual({
      action: 'defer',
      until: new Date('2026-11-05T14:00:00Z'),
    });
    expect(decideDelivery(n(1), ctx('2026-11-05T14:00:00Z', quiet))).toEqual({ action: 'send' });
  });

  it('defers normal notifications to the next quiet-hours end when off today', () => {
    expect(decideDelivery(n(1), ctx(DAY, { offToday: true }))).toEqual({
      action: 'defer',
      until: new Date('2026-11-06T06:00:00Z'),
    });
  });

  it('batches info notifications into the digest regardless of time or off today', () => {
    for (const t of [DAY, LATE]) {
      expect(decideDelivery(n(0, 'run_done'), ctx(t))).toEqual({ action: 'digest' });
      expect(decideDelivery(n(0, 'run_failed'), ctx(t, { offToday: true }))).toEqual({
        action: 'digest',
      });
    }
  });

  it('skips worker_online when no offline alert was sent for the outage', () => {
    expect(decideDelivery(n(2, 'worker_online'), ctx(DAY, { offlineAlertSent: false }))).toEqual({
      action: 'skip',
      reason: 'no offline alert was sent',
    });
    expect(decideDelivery(n(2, 'worker_online'), ctx(DAY, { offlineAlertSent: true }))).toEqual({
      action: 'send',
    });
  });

  it('handles DST: the quiet end is 07:00 local on both sides of the changeover', () => {
    // 2026-03-28 23:30 CET (22:30Z) -> next 07:00 is on the 29th, already CEST (05:00Z)
    expect(decideDelivery(n(1), ctx('2026-03-28T22:30:00Z'))).toEqual({
      action: 'defer',
      until: new Date('2026-03-29T05:00:00Z'),
    });
    // 2026-10-24 23:30 CEST (21:30Z) -> next 07:00 is the 25th (CEST until 03:00 local, 07:00 is CET = 06:00Z)
    expect(decideDelivery(n(1), ctx('2026-10-24T21:30:00Z'))).toEqual({
      action: 'defer',
      until: new Date('2026-10-25T06:00:00Z'),
    });
  });
});
