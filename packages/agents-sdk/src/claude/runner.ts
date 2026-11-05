import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { redactSecrets } from '@aziz-hq/core';
import { changedFiles, checkProtectedTests, checkScope } from '../guards/diff-checks.js';
import type { Runner, RunnerInput, RunnerResult } from '../runner.js';
import { classifyClaudeFailure, extractResetsAt } from './classify.js';
import { parseClaudeStream } from './parse-stream.js';

const execFileAsync = promisify(execFile);

export interface ClaudeRunnerOptions {
  /** The executable; tests point it at a fake. */
  claudeBin?: string;
  /** Arguments placed before the claude arguments (tests: the fake's script path). */
  claudeArgsPrefix?: string[];
  /** CLAUDE_CONFIG_DIR for the worker's own login (quota is still per account, spike S1). */
  configDir?: string;
  maxTurns?: number;
  /** Extra claude flags (e.g. a permission mode appropriate for the sandbox). */
  extraArgs?: string[];
  /** Extra environment for the process; nothing else is inherited except the allow-list below. */
  env?: Record<string, string>;
  inheritEnv?: string[];
  /** Existing files matching these globs must not be modified, deleted or renamed. */
  testGlobs?: string[];
  /** Unified diff of what the agent changed; default: `git add -N . && git diff HEAD` in the workdir. */
  readDiff?: (workdir: string) => Promise<string>;
  maxOutputBytes?: number;
}

const DEFAULT_ENV_ALLOW = ['PATH', 'HOME', 'LANG', 'TERM', 'TMPDIR'];
const SUMMARY_LIMIT = 2000;

async function defaultReadDiff(workdir: string): Promise<string> {
  await execFileAsync('git', ['add', '-N', '.'], { cwd: workdir });
  const { stdout } = await execFileAsync('git', ['diff', 'HEAD'], {
    cwd: workdir,
    maxBuffer: 64 * 1024 * 1024,
  });
  return stdout;
}

const tail = (s: string, n: number) => (s.length > n ? s.slice(s.length - n) : s);

/**
 * The first real runner: headless `claude -p` logged into the owner's plan (ADR, spike S1/S5). It builds a minimal
 * environment (no platform secrets are inherited), parses stream-json for usage and the rate-limit windows, treats a plan
 * limit as `limit` (a pause), redacts everything it returns, and checks the produced diff against the protected tests
 * and the task scope before reporting done.
 */
export class ClaudeCodeSubscriptionRunner implements Runner {
  readonly name = 'claude-code-subscription';

  constructor(private readonly options: ClaudeRunnerOptions = {}) {}

  async run(input: RunnerInput): Promise<RunnerResult> {
    const prompt = input.task.payload.prompt;
    if (typeof prompt !== 'string' || prompt.trim() === '') {
      return this.failed('config', 'task payload has no prompt');
    }
    const scope = Array.isArray(input.task.payload.scope)
      ? input.task.payload.scope.filter((s): s is string => typeof s === 'string')
      : null;

    const { code, stdout, stderr } = await this.execute(prompt, input);

    const parsed = parseClaudeStream(stdout);
    const transcript = redactSecrets(stdout);
    const common = {
      costUsd: parsed.usage?.costUsd ?? 0,
      usage: parsed.usage ?? undefined,
      rateLimit: parsed.rateLimit ?? undefined,
      transcript,
      events: parsed.events,
    };

    const failure = classifyClaudeFailure(code, stdout, stderr);
    if (failure === 'limit') {
      return {
        ...common,
        status: 'limit',
        summary: 'Claude plan limit reached',
        resetsAt: extractResetsAt(stdout) ?? undefined,
      };
    }
    if (failure === 'auth') {
      return {
        ...common,
        status: 'failed',
        errorKind: 'auth',
        summary: 'claude is not logged in (the worker login expired or is missing)',
      };
    }
    if (code !== 0 || parsed.result?.isError) {
      const text = parsed.result?.text || tail(stderr, 1000) || `claude exited with code ${code}`;
      return {
        ...common,
        status: 'failed',
        errorKind: 'claude_failed',
        summary: redactSecrets(tail(text, SUMMARY_LIMIT)),
      };
    }

    // success so far: the agent's changes must respect the protected tests and the task scope
    let diff: string;
    try {
      diff = await (this.options.readDiff ?? defaultReadDiff)(input.workdir);
    } catch (e) {
      return {
        ...common,
        status: 'failed',
        errorKind: 'guard_error',
        summary: `could not read the diff: ${e instanceof Error ? e.message : String(e)}`,
      };
    }
    const protectedTests = checkProtectedTests(
      diff,
      this.options.testGlobs ?? ['**/*.test.ts', '**/*.spec.ts', 'tests/**', 'supabase/tests/**'],
    );
    if (!protectedTests.ok) {
      const list = protectedTests.violations.map((v) => `${v.path} (${v.change})`).join(', ');
      return {
        ...common,
        status: 'failed',
        errorKind: 'protected_tests',
        summary: `existing tests must not be changed: ${list}`,
      };
    }
    if (scope) {
      const touched = changedFiles(diff).flatMap((f) => (f.from ? [f.path, f.from] : [f.path]));
      const inScope = checkScope(touched, scope);
      if (!inScope.ok) {
        return {
          ...common,
          status: 'failed',
          errorKind: 'out_of_scope',
          summary: `files outside the task scope: ${inScope.outside.join(', ')}`,
        };
      }
    }

    return {
      ...common,
      status: 'done',
      summary: redactSecrets(tail(parsed.result?.text ?? '', SUMMARY_LIMIT)),
    };
  }

  private failed(errorKind: string, summary: string): RunnerResult {
    return { status: 'failed', errorKind, summary, costUsd: 0, events: [] };
  }

  private execute(
    prompt: string,
    input: RunnerInput,
  ): Promise<{ code: number; stdout: string; stderr: string }> {
    const o = this.options;
    const env: Record<string, string> = {};
    for (const name of o.inheritEnv ?? DEFAULT_ENV_ALLOW) {
      const value = process.env[name];
      if (value !== undefined) env[name] = value;
    }
    Object.assign(env, o.env);
    if (o.configDir) env.CLAUDE_CONFIG_DIR = o.configDir;

    const args = [
      ...(o.claudeArgsPrefix ?? []),
      '-p',
      prompt,
      '--output-format',
      'stream-json',
      '--verbose',
      ...(o.maxTurns ? ['--max-turns', String(o.maxTurns)] : []),
      ...(o.extraArgs ?? []),
    ];
    const maxBytes = o.maxOutputBytes ?? 32 * 1024 * 1024;

    return new Promise((resolve, reject) => {
      const child = spawn(o.claudeBin ?? 'claude', args, {
        cwd: input.workdir,
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: true,
      });
      const killGroup = (signal: NodeJS.Signals) => {
        try {
          process.kill(-child.pid!, signal);
        } catch {
          // already gone
        }
      };
      const abortReason = () =>
        input.signal.reason instanceof Error ? input.signal.reason : new Error('aborted');
      const onAbort = () => {
        killGroup('SIGTERM');
        setTimeout(() => killGroup('SIGKILL'), 5000).unref();
      };
      if (input.signal.aborted) onAbort();
      else input.signal.addEventListener('abort', onAbort, { once: true });

      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (d: Buffer) => {
        if (stdout.length < maxBytes) stdout += d.toString();
      });
      child.stderr.on('data', (d: Buffer) => {
        if (stderr.length < 1_000_000) stderr += d.toString();
      });
      child.on('error', (e) => {
        input.signal.removeEventListener('abort', onAbort);
        reject(e);
      });
      child.on('close', (code) => {
        input.signal.removeEventListener('abort', onAbort);
        if (input.signal.aborted) reject(abortReason());
        else resolve({ code: code ?? 1, stdout, stderr });
      });
    });
  }
}
