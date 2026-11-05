import { FakeRunner, type Runner } from '@aziz-hq/agents-sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { executeTask } from './executor.js';
import { config, fakeEngine, task } from './test-helpers.js';

const silent = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

function setup(runner: Runner = new FakeRunner(), cfg = config(), engine = fakeEngine()) {
  const events = vi.fn(async () => undefined);
  const controller = new AbortController();
  const run = (t = task()) =>
    executeTask({ engine, runner, events, config: cfg, log: silent }, t, controller.signal);
  return { engine, events, controller, run };
}

describe('executeTask', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('completes a done result and records runner events', async () => {
    const { engine, events, run } = setup();
    expect(await run()).toBe('done');
    expect(engine.completeTask).toHaveBeenCalledWith('t1', 'w1', {
      summary: 'fake done',
      costUsd: 0,
    });
    expect(engine.failTask).not.toHaveBeenCalled();
    expect(events).toHaveBeenCalledWith(expect.objectContaining({ id: 't1' }), [
      { kind: 'runner.fake.started', data: { attempt: 1, role: 'builder' } },
      { kind: 'runner.fake.finished', data: { status: 'done' } },
    ]);
  });

  it('fails a failed result as retryable', async () => {
    const { engine, run } = setup();
    expect(
      await run(
        task({ payload: { fake: { outcomes: [{ status: 'failed', summary: 'tests red' }] } } }),
      ),
    ).toBe('failed');
    expect(engine.failTask).toHaveBeenCalledWith(
      't1',
      'w1',
      { kind: 'runner_failed', message: 'tests red' },
      true,
    );
  });

  it('turns needs_human into a non-retryable failure', async () => {
    const { engine, run } = setup();
    await run(
      task({ payload: { fake: { outcomes: [{ status: 'needs_human', summary: 'which one?' }] } } }),
    );
    expect(engine.failTask).toHaveBeenCalledWith(
      't1',
      'w1',
      { kind: 'needs_human', message: 'which one?' },
      false,
    );
  });

  it('turns a thrown error into a retryable failure', async () => {
    const boom: Runner = {
      name: 'boom',
      run: async () => {
        throw new Error('kaboom');
      },
    };
    const { engine, run } = setup(boom);
    expect(await run()).toBe('failed');
    expect(engine.failTask).toHaveBeenCalledWith(
      't1',
      'w1',
      { kind: 'runner_error', message: 'kaboom' },
      true,
    );
  });

  it('uses the task type as the role of tasks without one', async () => {
    const seen: string[] = [];
    const spy: Runner = {
      name: 's',
      run: async (i) => {
        seen.push(i.role);
        return { status: 'done', summary: '', costUsd: 0, events: [] };
      },
    };
    await setup(spy).run(task({ type: 'system', role: null }));
    expect(seen).toEqual(['system']);
  });

  it('renews the lease every third of the lease length', async () => {
    const { engine, run } = setup(new FakeRunner(), config({ leaseSeconds: 30 }));
    const p = run(task({ payload: { fake: { delayMs: 35_000 } } }));
    await vi.advanceTimersByTimeAsync(35_000);
    await p;
    expect(engine.heartbeatTask).toHaveBeenCalledTimes(3); // at 10s, 20s, 30s
    expect(engine.heartbeatTask).toHaveBeenCalledWith('t1', 'w1', 30);
  });

  it('drops the result and aborts the runner when the lease is lost', async () => {
    const engine = fakeEngine({ heartbeatTask: vi.fn(async () => false) });
    const { run } = setup(new FakeRunner(), config({ leaseSeconds: 30 }), engine);
    const p = run(task({ payload: { fake: { delayMs: 60_000 } } }));
    await vi.advanceTimersByTimeAsync(10_000);
    expect(await p).toBe('lease_lost');
    expect(engine.completeTask).not.toHaveBeenCalled();
    expect(engine.failTask).not.toHaveBeenCalled();
  });

  it('reports lease_lost when completion is refused (the lease was reaped meanwhile)', async () => {
    const engine = fakeEngine({ completeTask: vi.fn(async () => false) });
    expect(await setup(new FakeRunner(), config(), engine).run()).toBe('lease_lost');
  });

  it('enforces the task timeout with a retryable timeout failure', async () => {
    const { engine, run } = setup(new FakeRunner(), config({ taskTimeoutMs: 5000 }));
    const p = run(task({ payload: { fake: { outcomes: [{ status: 'done', hang: true }] } } }));
    await vi.advanceTimersByTimeAsync(5000);
    expect(await p).toBe('failed');
    expect(engine.failTask).toHaveBeenCalledWith(
      't1',
      'w1',
      { kind: 'timeout', message: expect.stringContaining('5000') },
      true,
    );
  });

  it('releases the task as a retryable shutdown failure when aborted from outside', async () => {
    const { engine, controller, run } = setup();
    const p = run(task({ payload: { fake: { outcomes: [{ status: 'done', hang: true }] } } }));
    await vi.advanceTimersByTimeAsync(100);
    controller.abort(new Error('shutdown'));
    expect(await p).toBe('failed');
    expect(engine.failTask).toHaveBeenCalledWith(
      't1',
      'w1',
      { kind: 'shutdown', message: 'worker is shutting down' },
      true,
    );
  });

  it('survives a failing heartbeat call', async () => {
    const engine = fakeEngine({
      heartbeatTask: vi.fn(async () => {
        throw new Error('network');
      }),
    });
    const { run } = setup(new FakeRunner(), config({ leaseSeconds: 30 }), engine);
    const p = run(task({ payload: { fake: { delayMs: 15_000 } } }));
    await vi.advanceTimersByTimeAsync(15_000);
    expect(await p).toBe('done');
  });
});
