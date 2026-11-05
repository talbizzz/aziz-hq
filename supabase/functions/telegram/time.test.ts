import { describe, expect, it } from 'vitest';
import { localDate, localMinutes, nextLocalTime, parseHHMM } from './time.ts';

const utc = (s: string) => new Date(s);

describe('parseHHMM', () => {
  it('parses valid times and rejects invalid ones', () => {
    expect(parseHHMM('07:00')).toBe(420);
    expect(parseHHMM('22:30')).toBe(1350);
    expect(parseHHMM('00:00')).toBe(0);
    for (const bad of ['7:00', '24:00', '12:60', 'abc', '', '12:5'])
      expect(() => parseHHMM(bad), bad).toThrow();
  });
});

describe('localMinutes and localDate (Europe/Berlin)', () => {
  it('uses the zone, not UTC', () => {
    expect(localMinutes(utc('2026-11-05T21:30:00Z'), 'Europe/Berlin')).toBe(22 * 60 + 30); // CET, UTC+1
    expect(localMinutes(utc('2026-07-05T21:30:00Z'), 'Europe/Berlin')).toBe(23 * 60 + 30); // CEST, UTC+2
    expect(localDate(utc('2026-11-05T23:30:00Z'), 'Europe/Berlin')).toBe('2026-11-06');
    expect(localDate(utc('2026-11-05T22:30:00Z'), 'Europe/Berlin')).toBe('2026-11-05');
  });
});

describe('nextLocalTime: the next occurrence of HH:MM strictly after now', () => {
  it('is today when it is still ahead, tomorrow when it has passed', () => {
    expect(nextLocalTime(utc('2026-11-05T05:00:00Z'), '07:00', 'Europe/Berlin')).toEqual(
      utc('2026-11-05T06:00:00Z'),
    );
    expect(nextLocalTime(utc('2026-11-05T21:00:00Z'), '07:00', 'Europe/Berlin')).toEqual(
      utc('2026-11-06T06:00:00Z'),
    );
    expect(nextLocalTime(utc('2026-11-05T06:00:00Z'), '07:00', 'Europe/Berlin')).toEqual(
      utc('2026-11-06T06:00:00Z'),
    ); // exactly 07:00 -> tomorrow
  });

  it('survives DST changeovers', () => {
    // DST starts 2026-03-29 (CET -> CEST): 07:00 local is 06:00Z before, 05:00Z after
    expect(nextLocalTime(utc('2026-03-28T22:30:00Z'), '07:00', 'Europe/Berlin')).toEqual(
      utc('2026-03-29T05:00:00Z'),
    );
    expect(nextLocalTime(utc('2026-03-28T05:00:00Z'), '07:00', 'Europe/Berlin')).toEqual(
      utc('2026-03-28T06:00:00Z'),
    );
    // DST ends 2026-10-25 (CEST -> CET)
    expect(nextLocalTime(utc('2026-10-24T22:30:00Z'), '07:00', 'Europe/Berlin')).toEqual(
      utc('2026-10-25T06:00:00Z'),
    );
  });

  it('works in UTC and in a zone behind UTC', () => {
    expect(nextLocalTime(utc('2026-06-01T10:00:00Z'), '08:00', 'UTC')).toEqual(
      utc('2026-06-02T08:00:00Z'),
    );
    expect(nextLocalTime(utc('2026-06-01T10:00:00Z'), '08:00', 'America/New_York')).toEqual(
      utc('2026-06-01T12:00:00Z'),
    );
  });
});
