import { describe, expect, it } from 'vitest';
import { parseSettingsForm, settingsToRows } from './settings.js';

const valid = {
  timezone: 'Europe/Berlin',
  quietStart: '22:00',
  quietEnd: '07:00',
  digestTime: '08:00',
};

describe('parseSettingsForm', () => {
  it('accepts valid settings', () => {
    expect(parseSettingsForm(valid)).toEqual({ ok: true, value: valid });
  });

  it('rejects malformed times with a message naming the field', () => {
    for (const [field, label] of [
      ['quietStart', 'Quiet hours start'],
      ['quietEnd', 'Quiet hours end'],
      ['digestTime', 'Digest time'],
    ] as const) {
      for (const bad of ['', '7:00', '24:00', '12:60', 'abc']) {
        const result = parseSettingsForm({ ...valid, [field]: bad });
        expect(result.ok, `${field}=${bad}`).toBe(false);
        if (!result.ok) expect(result.error).toContain(label);
      }
    }
  });

  it('rejects an unknown time zone', () => {
    const result = parseSettingsForm({ ...valid, timezone: 'Mars/Olympus' });
    expect(result).toEqual({ ok: false, error: expect.stringContaining('time zone') });
  });

  it('rejects empty quiet hours (start equal to end)', () => {
    expect(parseSettingsForm({ ...valid, quietStart: '08:00', quietEnd: '08:00' })).toEqual({
      ok: false,
      error: expect.stringContaining('different'),
    });
  });

  it('allows quiet hours spanning midnight and inside one day', () => {
    expect(parseSettingsForm({ ...valid, quietStart: '23:00', quietEnd: '06:00' }).ok).toBe(true);
    expect(parseSettingsForm({ ...valid, quietStart: '13:00', quietEnd: '15:00' }).ok).toBe(true);
  });
});

describe('settingsToRows', () => {
  it('maps the form to the settings keys and jsonb values the Edge Function reads', () => {
    expect(settingsToRows(valid)).toEqual([
      { key: 'timezone', value: 'Europe/Berlin' },
      { key: 'quiet_hours', value: { start: '22:00', end: '07:00' } },
      { key: 'digest_time', value: '08:00' },
    ]);
  });
});
