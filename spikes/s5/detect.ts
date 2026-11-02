export type FailureKind = 'limit' | 'auth' | 'other';

// Wording from code.claude.com/docs/en/errors.md (documented, not yet captured live; see S5 findings).
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

function events(stdout: string): Record<string, any>[] {
  const out: Record<string, any>[] = [];
  for (const line of stdout.split('\n')) {
    const t = line.trim();
    if (!t.startsWith('{')) continue;
    try {
      out.push(JSON.parse(t));
    } catch {
      /* not JSON, matched as text below */
    }
  }
  return out;
}

function blocked(e: Record<string, any>): boolean {
  if (e.type !== 'rate_limit_event') return false;
  const info = e.rate_limit_info ?? {};
  const windows = Object.values<any>(info.unifiedWindows ?? {});
  return (info.status && info.status !== 'allowed') || windows.some((w) => w.status && w.status !== 'allowed');
}

/**
 * Call only for a run that may have failed. A clean success also returns 'other'.
 * Exit code is not trusted: limit errors can arrive with exit 0 and is_error:true.
 */
export function classifyClaudeFailure(exitCode: number, stdout: string, stderr: string): FailureKind {
  const evs = events(stdout);
  if (evs.some(blocked)) return 'limit';
  const errored = exitCode !== 0 || evs.some((e) => e.type === 'result' && e.is_error === true);
  if (!errored) return 'other';
  const text = [...evs.filter((e) => typeof e.result === 'string').map((e) => e.result), stdout, stderr].join('\n');
  if (LIMIT.some((r) => r.test(text))) return 'limit';
  if (AUTH.some((r) => r.test(text))) return 'auth';
  return 'other';
}

/** Unix seconds when the blocked (else first) window resets, from the stream's rate_limit_event. */
export function extractResetsAt(stdout: string): number | null {
  for (const e of events(stdout)) {
    if (e.type !== 'rate_limit_event') continue;
    const info = e.rate_limit_info ?? {};
    const windows = Object.values<any>(info.unifiedWindows ?? {});
    const hit = windows.find((w) => w.status && w.status !== 'allowed');
    return hit?.resetsAt ?? info.resetsAt ?? null;
  }
  return null;
}
