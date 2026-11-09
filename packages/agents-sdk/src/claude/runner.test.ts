import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runnerResultSchema, type RunnerInput } from '../runner.js';
import { ClaudeCodeSubscriptionRunner } from './runner.js';

const here = (p: string) => fileURLToPath(new URL(`../../test/${p}`, import.meta.url));
const FAKE = here('fake-claude.mjs');
const STREAM = here('fixtures/claude-stream-recorded.jsonl');
const LIMIT = here('fixtures/s5-limit-stream-exit1.txt'); // DOCUMENTED shape; its "# ..." header lines are not JSON and are ignored
const AUTH = here('fixtures/s5-auth-exit1.txt');

let work: string;
let argsFile: string;
const git = (...args: string[]) => execFileSync('git', args, { cwd: work, stdio: 'pipe' });

beforeEach(() => {
  work = mkdtempSync(join(tmpdir(), 'claude-runner-'));
  argsFile = join(work, '.args.json');
  git('init', '-q');
  git('config', 'user.email', 't@example.test');
  git('config', 'user.name', 'T');
  writeFileSync(join(work, 'existing.test.ts'), 'old test\n');
  writeFileSync(join(work, 'src.ts'), 'old source\n');
  git('add', '.');
  git('commit', '-q', '-m', 'init');
});
afterEach(() => undefined);

const input = (
  payload: Record<string, unknown> = { prompt: 'do the thing' },
  signal = new AbortController().signal,
): RunnerInput => ({
  role: 'builder',
  task: { id: 't1', runId: 'r1', title: 'T', payload, attempt: 1 },
  context: {},
  workdir: work,
  budget: { timeoutMs: 60_000 },
  signal,
});
const runner = (env: Record<string, string>, over = {}) =>
  new ClaudeCodeSubscriptionRunner({
    claudeBin: process.execPath,
    claudeArgsPrefix: [FAKE],
    configDir: '/tmp/claude-config-test',
    env: { FAKE_CLAUDE_ARGS_FILE: argsFile, ...env },
    testGlobs: ['**/*.test.ts'],
    ...over,
  });

describe('ClaudeCodeSubscriptionRunner (against a fake claude CLI replaying recorded output)', () => {
  it('runs claude -p headless in the workdir and maps a successful stream to done with usage', async () => {
    const result = await runner({ FAKE_CLAUDE_FIXTURE: STREAM }).run(input());
    expect(runnerResultSchema.safeParse(result).success).toBe(true);
    expect(result).toMatchObject({ status: 'done', costUsd: 0.060913 });
    expect(result.usage).toMatchObject({
      inputTokens: 2,
      outputTokens: 4,
      cacheReadTokens: 23485,
      cacheWriteTokens: 14599,
    });
    expect(result.rateLimit?.fiveHour.pct).toBe(15);
    expect(result.transcript).toContain('rate_limit_event');
    expect(result.events.map((e) => e.kind)).toEqual(
      expect.arrayContaining(['claude.started', 'claude.finished']),
    );

    const seen = JSON.parse(readFileSync(argsFile, 'utf8')) as {
      argv: string[];
      cwd: string;
      configDir: string;
    };
    expect(seen.argv).toEqual(
      expect.arrayContaining(['-p', 'do the thing', '--output-format', 'stream-json', '--verbose']),
    );
    expect(readFileSync(argsFile, 'utf8')).toContain(work.replace(/\\/g, '/').split('/').pop()!);
    expect(seen.configDir).toBe('/tmp/claude-config-test');
  });

  it('passes USER (the macOS login lookup needs it) but none of the platform secrets', async () => {
    process.env.USER ||= 'tester';
    process.env.SUPABASE_SECRET_KEY = 'must-not-leak';
    try {
      await runner({ FAKE_CLAUDE_FIXTURE: STREAM }).run(input());
    } finally {
      delete process.env.SUPABASE_SECRET_KEY;
    }
    const seen = JSON.parse(readFileSync(argsFile, 'utf8')) as { envKeys: string[] };
    expect(seen.envKeys).toContain('USER');
    expect(seen.envKeys).not.toContain('SUPABASE_SECRET_KEY');
  });

  it('turns a blocked rate-limit stream into a limit result with the reset time (a pause, not a failure)', async () => {
    const result = await runner({ FAKE_CLAUDE_FIXTURE: LIMIT, FAKE_CLAUDE_EXIT: '1' }).run(input());
    expect(result).toMatchObject({ status: 'limit' });
    expect(result.resetsAt).toEqual(new Date(1793640600 * 1000));
  });

  it('reports a logged-out CLI as a failed run with errorKind auth', async () => {
    const result = await runner({ FAKE_CLAUDE_FIXTURE: AUTH, FAKE_CLAUDE_EXIT: '1' }).run(input());
    expect(result).toMatchObject({ status: 'failed', errorKind: 'auth' });
  });

  it('reports other failures (non-zero exit) as failed with the stderr tail', async () => {
    const result = await runner({
      FAKE_CLAUDE_EXIT: '2',
      FAKE_CLAUDE_STDERR: 'something broke',
    }).run(input());
    expect(result).toMatchObject({ status: 'failed', errorKind: 'claude_failed' });
    expect(result.summary).toContain('something broke');
  });

  it('fails clearly without a prompt', async () => {
    const result = await runner({ FAKE_CLAUDE_FIXTURE: STREAM }).run(input({}));
    expect(result).toMatchObject({ status: 'failed', errorKind: 'config' });
  });

  it('kills the process when aborted and rejects with the abort reason', async () => {
    const controller = new AbortController();
    const promise = runner({ FAKE_CLAUDE_SLEEP_MS: '30000' }).run(
      input({ prompt: 'x' }, controller.signal),
    );
    for (let i = 0; i < 100 && !existsSync(argsFile); i++)
      await new Promise((r) => setTimeout(r, 50));
    const { pid } = JSON.parse(readFileSync(argsFile, 'utf8')) as { pid: number };
    controller.abort(new Error('timeout'));
    await expect(promise).rejects.toThrow('timeout');
    for (let i = 0; i < 50; i++) {
      try {
        process.kill(pid, 0);
      } catch {
        return; // the process is gone
      }
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error('claude was not killed');
  });

  it('redacts secrets in the summary and the transcript', async () => {
    // low-entropy filler: still matches the redaction pattern, and gitleaks does not flag it
    const secret = ['sk', 'ant', 'api03', 'a'.repeat(30)].join('-');
    const result = await runner({
      FAKE_CLAUDE_FIXTURE: STREAM,
      FAKE_CLAUDE_APPEND_RESULT: `key is ${secret}`,
    }).run(input());
    expect(result.summary).not.toContain(secret);
    expect(result.transcript).not.toContain(secret);
    expect(result.summary).toContain('[REDACTED:anthropic]');
  });

  it('rejects a diff that modifies an existing test (protected tests)', async () => {
    const result = await runner({
      FAKE_CLAUDE_FIXTURE: STREAM,
      FAKE_CLAUDE_WRITE: 'existing.test.ts:changed\n|src.ts:new source\n',
    }).run(input());
    expect(result).toMatchObject({ status: 'failed', errorKind: 'protected_tests' });
    expect(result.summary).toContain('existing.test.ts');
  });

  it('accepts new tests and source edits', async () => {
    const result = await runner({
      FAKE_CLAUDE_FIXTURE: STREAM,
      FAKE_CLAUDE_WRITE: 'new.test.ts:new test\n|src.ts:new source\n',
    }).run(input());
    expect(result.status).toBe('done');
  });

  it('rejects files outside the task scope', async () => {
    const result = await runner({
      FAKE_CLAUDE_FIXTURE: STREAM,
      FAKE_CLAUDE_WRITE: 'src.ts:ok\n|package.json:{}\n',
    }).run(input({ prompt: 'x', scope: ['src.ts', '*.test.ts'] }));
    expect(result).toMatchObject({ status: 'failed', errorKind: 'out_of_scope' });
    expect(result.summary).toContain('package.json');
  });
});
