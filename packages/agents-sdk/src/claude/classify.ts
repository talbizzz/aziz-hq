import { jsonEvents, obj, str, type StreamEvent } from './events.js';

export type FailureKind = 'limit' | 'auth' | 'other';

// Wording from code.claude.com/docs/en/errors.md: DOCUMENTED, not yet captured live (spike S5). A live limit-hit capture is
// owed before M8; until then treat this as best-effort and keep the "unknown repeated failure => pause" fallback.
const LIMIT = [
  /you've hit your (session|weekly|opus|sonnet) limit/i,
  /usage limit reached/i,
  /request rejected \(429\)/i,
  /temporarily limiting requests/i,
  /rate_limit_error/i,
];
const AUTH = [
  /not logged in/i,
  /login expired/i,
  /authentication required/i,
  /invalid api key/i,
  /invalid authentication credentials/i,
  /oauth token (revoked|has expired)/i,
  /account is on hold/i,
];

function blocked(e: StreamEvent): boolean {
  if (e.type !== 'rate_limit_event') return false;
  const info = obj(e.rate_limit_info);
  const windows = Object.values(obj(info.unifiedWindows)).map(obj);
  const status = str(info.status);
  return (
    (status !== undefined && status !== 'allowed') ||
    windows.some((w) => str(w.status) !== undefined && w.status !== 'allowed')
  );
}

/**
 * Call only for a run that may have failed; a clean success also returns 'other'.
 * The exit code is not trusted: limit errors can arrive with exit 0 and is_error:true (spike S1/S5).
 */
export function classifyClaudeFailure(
  exitCode: number,
  stdout: string,
  stderr: string,
): FailureKind {
  const events = jsonEvents(stdout);
  if (events.some(blocked)) return 'limit';
  const errored = exitCode !== 0 || events.some((e) => e.type === 'result' && e.is_error === true);
  if (!errored) return 'other';
  const text = [
    ...events.map((e) => str(e.result)).filter((r): r is string => r !== undefined),
    stdout,
    stderr,
  ].join('\n');
  if (LIMIT.some((r) => r.test(text))) return 'limit';
  if (AUTH.some((r) => r.test(text))) return 'auth';
  return 'other';
}

/** When the blocked (else the first reported) window resets, from the stream's rate_limit_event. */
export function extractResetsAt(stdout: string): Date | null {
  for (const e of jsonEvents(stdout)) {
    if (e.type !== 'rate_limit_event') continue;
    const info = obj(e.rate_limit_info);
    const windows = Object.values(obj(info.unifiedWindows)).map(obj);
    const hit = windows.find((w) => str(w.status) !== undefined && w.status !== 'allowed');
    const seconds = (hit?.resetsAt ?? info.resetsAt) as unknown;
    if (typeof seconds === 'number' && Number.isFinite(seconds)) return new Date(seconds * 1000);
  }
  return null;
}
