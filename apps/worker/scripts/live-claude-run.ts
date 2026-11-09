// T4.9: one real, tiny `claude -p` run through ClaudeCodeSubscriptionRunner in a throwaway git repo. It consumes a little
// of the owner's plan quota, so it is manual and never part of CI. It touches no database.
// Usage: pnpm --filter @aziz-hq/worker exec tsx scripts/live-claude-run.ts [outDir]   (the redacted stream is written to <outDir>/live-claude-stream.jsonl)
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ClaudeCodeSubscriptionRunner } from '@aziz-hq/agents-sdk';

const outDir = process.argv[2] ?? process.cwd();
const repo = mkdtempSync(join(tmpdir(), 'aziz-hq-live-'));
const git = (...args: string[]) => execFileSync('git', args, { cwd: repo, stdio: 'ignore' });
git('init', '-q');
git('config', 'user.email', 'live@example.invalid');
git('config', 'user.name', 'live-run');
writeFileSync(join(repo, 'README.md'), '# throwaway\n');
git('add', '.');
git('commit', '-q', '-m', 'init');

const runner = new ClaudeCodeSubscriptionRunner({
  maxTurns: 3,
  // the smallest model, and only the Write tool: nothing else can run
  extraArgs: ['--model', 'haiku', '--allowedTools', 'Write'],
});

const started = Date.now();
const result = await runner.run({
  role: 'builder',
  task: {
    id: 'live-1',
    runId: 'live-run',
    title: 'create hello.js',
    attempt: 1,
    payload: {
      prompt:
        'Create a file named hello.js in the current directory that prints exactly the text hello with console.log. Do nothing else.',
      scope: ['hello.js'],
    },
  },
  context: {},
  workdir: repo,
  budget: { timeoutMs: 120_000 },
  signal: AbortSignal.timeout(120_000),
});

mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'live-claude-stream.jsonl'), result.transcript ?? '');
const hello = (() => {
  try {
    return readFileSync(join(repo, 'hello.js'), 'utf8');
  } catch {
    return null;
  }
})();
console.log(
  JSON.stringify(
    {
      status: result.status,
      errorKind: result.errorKind,
      summary: result.summary,
      seconds: Math.round((Date.now() - started) / 1000),
      usage: result.usage,
      rateLimit: result.rateLimit,
      eventKinds: result.events.map((e) => e.kind),
      helloJs: hello,
    },
    null,
    2,
  ),
);
