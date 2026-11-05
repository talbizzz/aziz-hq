import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { classifyClaudeFailure, extractResetsAt } from './classify.js';

// Fixture format: leading "# ..." comment lines, one of which is "# exit=<n>"; the rest is stdout.
// The s5-* fixtures are DOCUMENTED wording/shapes, not live captures (spike S5); the live capture is owed before M8.
function fixture(name: string) {
  const raw = readFileSync(new URL(`../../test/fixtures/${name}`, import.meta.url), 'utf8');
  const lines = raw.split('\n');
  const exit = Number(lines.find((l) => l.startsWith('# exit='))?.slice(7));
  const stdout = lines.filter((l) => !l.startsWith('# ')).join('\n');
  return { exit, stdout };
}

describe('classifyClaudeFailure', () => {
  it('limit: is_error result with exit 0', () => {
    const f = fixture('s5-limit-json-exit0.txt');
    expect(f.exit).toBe(0);
    expect(classifyClaudeFailure(f.exit, f.stdout, '')).toBe('limit');
  });
  it('limit: blocked rate_limit_event in the stream', () => {
    const f = fixture('s5-limit-stream-exit1.txt');
    expect(classifyClaudeFailure(f.exit, f.stdout, '')).toBe('limit');
  });
  it('limit: weekly limit plain text', () => {
    const f = fixture('s5-weekly-text-exit1.txt');
    expect(classifyClaudeFailure(f.exit, f.stdout, '')).toBe('limit');
  });
  it('limit: 429 text on stderr', () => {
    expect(classifyClaudeFailure(1, '', 'Request rejected (429)')).toBe('limit');
  });
  it('auth: not logged in', () => {
    const f = fixture('s5-auth-exit1.txt');
    expect(classifyClaudeFailure(f.exit, f.stdout, '')).toBe('auth');
  });
  it('other: SIGTERM exit 143 with empty output', () => {
    const f = fixture('s5-other-exit143.txt');
    expect(classifyClaudeFailure(f.exit, f.stdout, '')).toBe('other');
  });
  it('other: a successful run with allowed windows', () => {
    const f = fixture('s5-ok-stream.txt');
    expect(classifyClaudeFailure(f.exit, f.stdout, '')).toBe('other');
  });
  it('other: the recorded real stream (allowed windows)', () => {
    const stdout = readFileSync(
      new URL('../../test/fixtures/claude-stream-recorded.jsonl', import.meta.url),
      'utf8',
    );
    expect(classifyClaudeFailure(0, stdout, '')).toBe('other');
  });
  it('other: an unrelated failure', () => {
    expect(classifyClaudeFailure(2, '', 'Error: --json-schema is not a valid JSON Schema')).toBe(
      'other',
    );
  });
  it('tolerates noise lines and a truncated last line', () => {
    const blocked =
      '{"type":"rate_limit_event","rate_limit_info":{"status":"blocked","unifiedWindows":{"five_hour":{"utilization":1,"resetsAt":1793640600,"status":"blocked"}}}}';
    expect(classifyClaudeFailure(1, `warning: something\n${blocked}\n{"type":"res`, '')).toBe(
      'limit',
    );
  });
});

describe('extractResetsAt', () => {
  it('reads the blocked window reset from the stream as a Date', () => {
    const f = fixture('s5-limit-stream-exit1.txt');
    expect(extractResetsAt(f.stdout)).toEqual(new Date(1793640600 * 1000));
  });
  it('returns null when absent', () => {
    expect(extractResetsAt("You've hit your weekly limit")).toBeNull();
    expect(extractResetsAt('')).toBeNull();
  });
});
