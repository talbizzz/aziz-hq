import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { classifyClaudeFailure, extractResetsAt } from './detect';

// Fixture format: leading "# ..." comment lines, one of which is "# exit=<n>"; the rest is stdout.
function fixture(name: string) {
  const raw = readFileSync(new URL(`../../docs/spikes/evidence/${name}`, import.meta.url), 'utf8');
  const lines = raw.split('\n');
  const exit = Number(lines.find((l) => l.startsWith('# exit='))?.slice(7));
  const stdout = lines.filter((l) => !l.startsWith('# ')).join('\n');
  return { exit, stdout };
}

describe('classifyClaudeFailure', () => {
  it('limit: is_error result with exit 0', () => {
    const f = fixture('S5-fixture-limit-json-exit0.txt');
    expect(f.exit).toBe(0);
    expect(classifyClaudeFailure(f.exit, f.stdout, '')).toBe('limit');
  });
  it('limit: blocked rate_limit_event in stream', () => {
    const f = fixture('S5-fixture-limit-stream-exit1.txt');
    expect(classifyClaudeFailure(f.exit, f.stdout, '')).toBe('limit');
  });
  it('limit: weekly limit plain text', () => {
    const f = fixture('S5-fixture-weekly-text-exit1.txt');
    expect(classifyClaudeFailure(f.exit, f.stdout, '')).toBe('limit');
  });
  it('limit: 429 text on stderr', () => {
    expect(classifyClaudeFailure(1, '', 'Request rejected (429)')).toBe('limit');
  });
  it('auth: not logged in', () => {
    const f = fixture('S5-fixture-auth-exit1.txt');
    expect(classifyClaudeFailure(f.exit, f.stdout, '')).toBe('auth');
  });
  it('other: SIGTERM exit 143 with empty output', () => {
    const f = fixture('S5-fixture-other-exit143.txt');
    expect(classifyClaudeFailure(f.exit, f.stdout, '')).toBe('other');
  });
  it('other: successful run with allowed windows', () => {
    const f = fixture('S5-fixture-ok-stream.txt');
    expect(classifyClaudeFailure(f.exit, f.stdout, '')).toBe('other');
  });
  it('other: unrelated failure', () => {
    expect(classifyClaudeFailure(2, '', 'Error: --json-schema is not a valid JSON Schema')).toBe('other');
  });
});

describe('extractResetsAt', () => {
  it('reads the blocked window reset from the stream', () => {
    const f = fixture('S5-fixture-limit-stream-exit1.txt');
    expect(extractResetsAt(f.stdout)).toBe(1793640600);
  });
  it('returns null when absent', () => {
    expect(extractResetsAt("You've hit your weekly limit")).toBeNull();
  });
});
