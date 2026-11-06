import { describe, expect, it } from 'vitest';
import { overrideChip, type ActiveOverride } from './overrides.js';

const at = (iso: string) => new Date(iso).toISOString();
const o = (kind: string, over: Partial<ActiveOverride> = {}): ActiveOverride => ({
  kind,
  expires_at: at('2026-11-05T15:30:00Z'),
  created_at: at('2026-11-05T10:30:00Z'),
  cap_pct: null,
  created_by: 'dashboard',
  ...over,
});
const fmt = (iso: string | null) => (iso ? iso.slice(11, 16) : '');

describe('overrideChip', () => {
  it('is empty without overrides', () => {
    expect(overrideChip([], fmt)).toBe('');
  });
  it('describes each kind with its expiry', () => {
    expect(overrideChip([o('pause')], fmt)).toBe('Paused until 15:30');
    expect(overrideChip([o('stop')], fmt)).toBe('Stopped until 15:30');
    expect(overrideChip([o('working')], fmt)).toBe('Working until 15:30');
    expect(overrideChip([o('sleeping')], fmt)).toBe('Sleeping until 15:30');
    expect(overrideChip([o('custom', { cap_pct: 70 })], fmt)).toBe('Custom 70% until 15:30');
    expect(overrideChip([o('off_today')], fmt)).toBe('Off today');
    expect(overrideChip([o('limit')], fmt)).toBe('Plan limit hit, resumes 15:30');
    expect(overrideChip([o('pacing_bypass_day')], fmt)).toBe('Weekly pacing ignored until 15:30');
    expect(overrideChip([o('pacing_bypass_week')], fmt)).toBe(
      'Weekly pacing ignored until the week resets',
    );
  });
  it('shows the longer bypass when both are active', () => {
    expect(overrideChip([o('pacing_bypass_day'), o('pacing_bypass_week')], fmt)).toBe(
      'Weekly pacing ignored until the week resets',
    );
  });
  it('joins several in a stable order: limit, pause/stop, mode, off today', () => {
    expect(overrideChip([o('off_today'), o('working'), o('limit'), o('stop')], fmt)).toBe(
      'Plan limit hit, resumes 15:30 · Stopped until 15:30 · Working until 15:30 · Off today',
    );
    expect(overrideChip([o('pacing_bypass_day'), o('working')], fmt)).toBe(
      'Working until 15:30 · Weekly pacing ignored until 15:30',
    );
  });
  it('shows only the most recently created mode', () => {
    const older = o('working', { created_at: at('2026-11-05T09:00:00Z') });
    const newer = o('sleeping', { created_at: at('2026-11-05T10:00:00Z') });
    expect(overrideChip([older, newer], fmt)).toBe('Sleeping until 15:30');
  });
});
