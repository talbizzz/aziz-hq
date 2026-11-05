import type { Runner, RunnerResult } from '@aziz-hq/agents-sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RunRecorder } from './engine.js';
import { executeTask } from './executor.js';
import { config, fakeEngine, task } from './test-helpers.js';

const silent = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
const result = (over: Partial<RunnerResult>): RunnerResult => ({
  status: 'done',
  summary: 's',
  costUsd: 0,
  events: [],
  ...over,
});
const runnerReturning = (r: RunnerResult): Runner => ({
  name: 'claude-code-subscription',
  run: async () => r,
});

function setup(r: RunnerResult, taskOver = {}) {
  const engine = fakeEngine();
  const recorder = {
    usage: vi.fn(async () => undefined),
    transcript: vi.fn(async () => undefined),
    escalate: vi.fn(async () => undefined),
  } satisfies RunRecorder;
  const run = () =>
    executeTask(
      {
        engine,
        runner: runnerReturning(r),
        events: vi.fn(async () => undefined),
        recorder,
        config: config(),
        log: silent,
      },
      task(taskOver),
      new AbortController().signal,
    );
  return { engine, recorder, run };
}

const usage = {
  inputTokens: 1,
  outputTokens: 2,
  cacheReadTokens: 3,
  cacheWriteTokens: 4,
  costUsd: 0.5,
  model: 'm',
};
const window = (pct: number) => ({
  pct,
  resetsAt: new Date('2026-11-05T15:00:00Z'),
  status: 'allowed',
});

describe('executeTask: plan limits are a pause, not a failure', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('releases the task for the limit with the reset time and does not complete or fail it', async () => {
    const resetsAt = new Date('2026-11-05T15:00:00Z');
    const { engine, recorder, run } = setup(
      result({ status: 'limit', resetsAt, summary: 'limit' }),
    );
    expect(await run()).toBe('limit');
    expect(engine.releaseForLimit).toHaveBeenCalledWith('t1', 'w1', resetsAt);
    expect(engine.completeTask).not.toHaveBeenCalled();
    expect(engine.failTask).not.toHaveBeenCalled();
    expect(recorder.escalate).not.toHaveBeenCalled();
  });

  it('passes a missing reset time as null and reports lease_lost when the release is refused', async () => {
    const a = setup(result({ status: 'limit' }));
    await a.run();
    expect(a.engine.releaseForLimit).toHaveBeenCalledWith('t1', 'w1', null);
    const b = setup(result({ status: 'limit' }));
    b.engine.releaseForLimit.mockResolvedValueOnce(false);
    expect(await b.run()).toBe('lease_lost');
  });
});

describe('executeTask: usage, snapshots and transcripts', () => {
  it('records a usage row, a usage snapshot and the transcript for a finished run', async () => {
    const { engine, recorder, run } = setup(
      result({
        usage,
        rateLimit: { fiveHour: window(15), sevenDay: window(9) },
        transcript: 'redacted transcript',
      }),
    );
    expect(await run()).toBe('done');
    expect(recorder.usage).toHaveBeenCalledWith(
      expect.objectContaining({ id: 't1' }),
      'claude-code-subscription',
      usage,
    );
    expect(engine.recordUsageSnapshot).toHaveBeenCalledWith({
      source: 'rate_limit_event',
      fiveHour: { pct: 15, resetsAt: new Date('2026-11-05T15:00:00Z') },
      sevenDay: { pct: 9, resetsAt: new Date('2026-11-05T15:00:00Z') },
      runId: 'r1',
      taskId: 't1',
    });
    expect(recorder.transcript).toHaveBeenCalledWith(
      expect.objectContaining({ id: 't1' }),
      'redacted transcript',
    );
  });

  it('also records them for a limit result, and a failing recorder never fails the task', async () => {
    const { engine, recorder, run } = setup(result({ status: 'limit', usage, transcript: 't' }));
    recorder.usage.mockRejectedValueOnce(new Error('db down'));
    expect(await run()).toBe('limit');
    expect(engine.releaseForLimit).toHaveBeenCalled();
    expect(recorder.transcript).toHaveBeenCalled();
  });

  it('records nothing when the result carries nothing', async () => {
    const { engine, recorder, run } = setup(result({}));
    await run();
    expect(recorder.usage).not.toHaveBeenCalled();
    expect(engine.recordUsageSnapshot).not.toHaveBeenCalled();
    expect(recorder.transcript).not.toHaveBeenCalled();
  });
});

describe('executeTask: failures and escalation', () => {
  it.each(['auth', 'config', 'protected_tests', 'out_of_scope', 'guard_error'])(
    '%s is not retried and escalates once',
    async (errorKind) => {
      const { engine, recorder, run } = setup(
        result({ status: 'failed', errorKind, summary: 'bad' }),
      );
      expect(await run()).toBe('failed');
      expect(engine.failTask).toHaveBeenCalledWith(
        't1',
        'w1',
        { kind: errorKind, message: 'bad' },
        false,
      );
      expect(recorder.escalate).toHaveBeenCalledOnce();
      expect(recorder.escalate).toHaveBeenCalledWith(
        expect.objectContaining({ id: 't1' }),
        expect.objectContaining({ errorKind, summary: 'bad', attempt: 1, maxAttempts: 3 }),
      );
    },
  );

  it('retries an ordinary failure while attempts remain, without escalating', async () => {
    const { engine, recorder, run } = setup(
      result({ status: 'failed', errorKind: 'claude_failed', summary: 'boom' }),
      { attempts: 1, max_attempts: 3 },
    );
    await run();
    expect(engine.failTask).toHaveBeenCalledWith(
      't1',
      'w1',
      { kind: 'claude_failed', message: 'boom' },
      true,
    );
    expect(recorder.escalate).not.toHaveBeenCalled();
  });

  it('escalates before the last attempt fails, so the gate exists when the run settles', async () => {
    const { engine, recorder, run } = setup(result({ status: 'failed', summary: 'boom' }), {
      attempts: 3,
      max_attempts: 3,
    });
    const order: string[] = [];
    recorder.escalate.mockImplementation(async () => void order.push('escalate'));
    engine.failTask.mockImplementation(async () => (order.push('fail'), 'failed' as const));
    await run();
    expect(order).toEqual(['escalate', 'fail']);
  });

  it('turns needs_human into a non-retryable failure that escalates with the question', async () => {
    const { engine, recorder, run } = setup(
      result({ status: 'needs_human', summary: 'which colour?' }),
    );
    await run();
    expect(engine.failTask).toHaveBeenCalledWith(
      't1',
      'w1',
      { kind: 'needs_human', message: 'which colour?' },
      false,
    );
    expect(recorder.escalate).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ errorKind: 'needs_human', summary: 'which colour?' }),
    );
  });

  it('still fails the task when escalation itself fails', async () => {
    const { engine, recorder, run } = setup(
      result({ status: 'failed', errorKind: 'config', summary: 'x' }),
    );
    recorder.escalate.mockRejectedValueOnce(new Error('run is not open'));
    expect(await run()).toBe('failed');
    expect(engine.failTask).toHaveBeenCalled();
  });
});
