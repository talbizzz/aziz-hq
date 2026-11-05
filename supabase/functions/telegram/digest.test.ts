import { describe, expect, it } from 'vitest';
import { compileDigest, isDigestDue, type DigestItem } from './digest.js';

const item = (kind: DigestItem['kind'], title: string): DigestItem => ({
  kind,
  payload: { title },
});

describe('isDigestDue', () => {
  const base = { timezone: 'Europe/Berlin', digestTime: '08:00' };
  it('is due once per local day, from digest_time on', () => {
    expect(
      isDigestDue({ ...base, now: new Date('2026-11-05T06:59:00Z'), lastDigestDate: null }),
    ).toBe(false); // 07:59 local
    expect(
      isDigestDue({ ...base, now: new Date('2026-11-05T07:00:00Z'), lastDigestDate: null }),
    ).toBe(true); // 08:00 local
    expect(
      isDigestDue({ ...base, now: new Date('2026-11-05T15:00:00Z'), lastDigestDate: null }),
    ).toBe(true);
    expect(
      isDigestDue({ ...base, now: new Date('2026-11-05T15:00:00Z'), lastDigestDate: '2026-11-05' }),
    ).toBe(false);
    expect(
      isDigestDue({ ...base, now: new Date('2026-11-06T07:30:00Z'), lastDigestDate: '2026-11-05' }),
    ).toBe(true);
  });
  it('uses the local date: 23:30 local is still the same day', () => {
    expect(
      isDigestDue({ ...base, now: new Date('2026-11-05T22:30:00Z'), lastDigestDate: '2026-11-05' }),
    ).toBe(false);
    expect(
      isDigestDue({ ...base, now: new Date('2026-11-05T23:30:00Z'), lastDigestDate: '2026-11-05' }),
    ).toBe(false); // 00:30 on the 6th: new day, but before 08:00
    expect(
      isDigestDue({ ...base, now: new Date('2026-11-06T07:30:00Z'), lastDigestDate: '2026-11-05' }),
    ).toBe(true); // 08:30 on the 6th
  });
});

describe('compileDigest', () => {
  it('returns null for an empty digest', () => {
    expect(compileDigest([])).toBeNull();
  });
  it('summarises counts and lists items, escaping HTML', () => {
    const text = compileDigest([
      item('run_done', 'Build <A>'),
      item('run_done', 'Build B'),
      item('run_failed', 'Tests & lint'),
      item('gate_open', 'Info gate'),
    ])!;
    expect(text).toContain('Daily digest');
    expect(text).toContain('2 runs finished');
    expect(text).toContain('1 run failed');
    expect(text).toContain('Build &lt;A&gt;');
    expect(text).toContain('Tests &amp; lint');
    expect(text).toContain('Info gate');
    expect(text).not.toContain('<A>');
  });
  it('caps the list and says how many were left out', () => {
    const many = Array.from({ length: 30 }, (_, i) => item('run_done', `run ${i}`));
    const text = compileDigest(many)!;
    expect(text).toContain('30 runs finished');
    expect(text).toContain('and 10 more');
    expect(text.length).toBeLessThan(4096);
  });
});
