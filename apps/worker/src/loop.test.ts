import { FakeRunner, RunnerRegistry } from '@aziz-hq/agents-sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runWorker } from './loop.js';
import { config, fakeEngine, task } from './test-helpers.js';

const silent = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
const registry = new RunnerRegistry().register('fake', new FakeRunner());
const runners = { default: 'fake', roles: {} };

function setup(over: Parameters<typeof fakeEngine>[0] = {}, cfg = config()) {
  const engine = fakeEngine(over);
  const controller = new AbortController();
  const events = vi.fn(async () => undefined);
  const done = runWorker(
    { engine, runners: registry, runnerConfig: runners, events, config: cfg, log: silent },
    controller.signal,
  );
  return { engine, controller, done };
}
const hang = { fake: { outcomes: [{ status: 'done', hang: true }] } };

describe('runWorker', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('ticks, claims and completes tasks', async () => {
    const queue = [task({ id: 'a' }), task({ id: 'b' })];
    const { engine, controller, done } = setup({
      claimTask: vi.fn(async () => queue.shift() ?? null),
    });
    await vi.advanceTimersByTimeAsync(10);
    expect(engine.schedulerTick).toHaveBeenCalled();
    expect(engine.completeTask).toHaveBeenCalledWith('a', 'w1', expect.anything());
    expect(engine.completeTask).toHaveBeenCalledWith('b', 'w1', expect.anything());
    controller.abort();
    await done;
  });

  it('never runs more tasks than the concurrency', async () => {
    let id = 0;
    const { engine, controller, done } = setup(
      { claimTask: vi.fn(async () => task({ id: `t${++id}`, payload: hang })) },
      config({ concurrency: 2 }),
    );
    await vi.advanceTimersByTimeAsync(5000);
    expect(engine.claimTask).toHaveBeenCalledTimes(2);
    controller.abort();
    await vi.advanceTimersByTimeAsync(10_000);
    await done;
  });

  it('sleeps for the poll interval when there is nothing to claim', async () => {
    const { engine, controller, done } = setup({}, config({ pollIntervalMs: 1000 }));
    await vi.advanceTimersByTimeAsync(10);
    const before = engine.claimTask.mock.calls.length;
    await vi.advanceTimersByTimeAsync(900);
    expect(engine.claimTask.mock.calls.length).toBe(before);
    await vi.advanceTimersByTimeAsync(200);
    expect(engine.claimTask.mock.calls.length).toBe(before + 1);
    controller.abort();
    await done;
  });

  it('sends a worker heartbeat at start and every interval', async () => {
    const { engine, controller, done } = setup({}, config({ heartbeatIntervalMs: 60_000 }));
    await vi.advanceTimersByTimeAsync(10);
    expect(engine.workerHeartbeat).toHaveBeenCalledTimes(1);
    expect(engine.workerHeartbeat).toHaveBeenCalledWith(
      'w1',
      expect.objectContaining({ concurrency: 2 }),
    );
    await vi.advanceTimersByTimeAsync(120_000);
    expect(engine.workerHeartbeat.mock.calls.length).toBeGreaterThanOrEqual(3);
    controller.abort();
    await done;
  });

  it('backs off on RPC errors without crashing and recovers', async () => {
    let calls = 0;
    const { engine, controller, done } = setup({
      schedulerTick: vi.fn(async () => {
        if (++calls <= 3) throw new Error('db down');
        return { reaped: 0, gatesOpened: 0, cancelled: 0, runsSettled: 0 };
      }),
    });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(engine.schedulerTick.mock.calls.length).toBeGreaterThan(3);
    expect(silent.warn).toHaveBeenCalled();
    controller.abort();
    await done;
  });

  it('waits for running tasks on shutdown, then releases them after the grace period', async () => {
    const { engine, controller, done } = setup(
      {
        claimTask: vi
          .fn()
          .mockResolvedValueOnce(task({ id: 'slow', payload: hang }))
          .mockResolvedValue(null),
      },
      config({ shutdownGraceMs: 5000 }),
    );
    await vi.advanceTimersByTimeAsync(100);
    controller.abort();
    await vi.advanceTimersByTimeAsync(4000);
    expect(engine.failTask).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2000);
    await done;
    expect(engine.failTask).toHaveBeenCalledWith(
      'slow',
      'w1',
      { kind: 'shutdown', message: 'worker is shutting down' },
      true,
    );
  });

  it('stops claiming once shutdown starts', async () => {
    const { engine, controller, done } = setup();
    await vi.advanceTimersByTimeAsync(10);
    controller.abort();
    await done;
    const after = engine.claimTask.mock.calls.length;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(engine.claimTask.mock.calls.length).toBe(after);
  });
});
