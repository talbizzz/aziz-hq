import { escapeHtml } from './format.ts';
import { localDate, localMinutes, parseHHMM } from './time.ts';

export interface DigestItem {
  kind: string;
  payload: Record<string, unknown>;
}

const MAX_LISTED = 20;

/** Due once per local day, from `digest_time` on. */
export function isDigestDue(input: {
  now: Date;
  timezone: string;
  digestTime: string;
  lastDigestDate: string | null;
}): boolean {
  return (
    localMinutes(input.now, input.timezone) >= parseHHMM(input.digestTime) &&
    localDate(input.now, input.timezone) !== input.lastDigestDate
  );
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function compileDigest(items: DigestItem[]): string | null {
  if (items.length === 0) return null;
  const count = (kind: string) => items.filter((i) => i.kind === kind).length;
  const done = count('run_done');
  const failed = count('run_failed');
  const other = items.length - done - failed;

  const summary = [
    done > 0 ? plural(done, 'run finished', 'runs finished') : null,
    failed > 0 ? plural(failed, 'run failed', 'runs failed') : null,
    other > 0 ? plural(other, 'other item', 'other items') : null,
  ].filter(Boolean);

  const lines = items
    .slice(0, MAX_LISTED)
    .map((i) => `• ${escapeHtml(String(i.payload.title ?? i.kind))}`);
  const more = items.length > MAX_LISTED ? [`… and ${items.length - MAX_LISTED} more`] : [];
  return ['<b>Daily digest</b>', summary.join(' · '), ...lines, ...more].join('\n');
}
