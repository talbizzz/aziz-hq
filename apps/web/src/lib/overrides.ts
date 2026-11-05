export interface ActiveOverride {
  kind: string;
  expires_at: string | null;
  created_at: string | null;
  cap_pct: number | null;
  created_by: string | null;
}

const defaultFormat = (iso: string | null) =>
  iso ? new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';

const newest = (items: ActiveOverride[]) =>
  [...items].sort((a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? ''))[0];

/** The header chip: plan limit, the latest pause/stop, the latest usage mode, then "off today". */
export function overrideChip(
  overrides: ActiveOverride[],
  format: (iso: string | null) => string = defaultFormat,
): string {
  const parts: string[] = [];
  const limit = newest(overrides.filter((o) => o.kind === 'limit'));
  if (limit) parts.push(`Plan limit hit, resumes ${format(limit.expires_at)}`);

  const hold = newest(overrides.filter((o) => o.kind === 'pause' || o.kind === 'stop'));
  if (hold)
    parts.push(`${hold.kind === 'pause' ? 'Paused' : 'Stopped'} until ${format(hold.expires_at)}`);

  const mode = newest(overrides.filter((o) => ['working', 'sleeping', 'custom'].includes(o.kind)));
  if (mode) {
    const name =
      mode.kind === 'custom'
        ? `Custom ${mode.cap_pct ?? ''}%`
        : mode.kind === 'working'
          ? 'Working'
          : 'Sleeping';
    parts.push(`${name} until ${format(mode.expires_at)}`);
  }

  if (overrides.some((o) => o.kind === 'off_today')) parts.push('Off today');
  return parts.join(' · ');
}
