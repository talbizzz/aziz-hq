import { FakeRunner, RunnerRegistry } from '@aziz-hq/agents-sdk';
import type { PolicyDecision } from '@aziz-hq/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runWorker } from './loop.js';
import { config, fakeEngine, task } from './test-helpers.js';

const silent = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
const registry = new RunnerRegistry().register('fake', new FakeRunner());
const runners = { default: 'fake', roles: {} };
const allow: PolicyDecision = { allow: true, capPct: 50, reason: 'work_hours' };

function setup(policy: () => Promise<PolicyDecision>, cfg = config({ pollIntervalMs: 1000 })) {
  const queue = [task({ id: 'a' })];
  const engine = fakeEngine({ claimTask: vi.fn(async () => queue.shift() ?? null) });
  const controller = new AbortController();
  const done = runWorker(
    {
      engine,
      runners: registry,
      runnerConfig: runners,
      events: vi.fn(async () => undefined),
      policy,
      config: cfg,
      log: silent,
    },
    controller.signal,
  );
  return { engine, controller, done };
}

describe('runWorker with a usage policy', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-05T12:00:00Z'));
    silent.info.mockClear();
  });
  afterEach(() => vi.useRealTimers());

  it('does not claim while the policy denies, but keeps ticking the scheduler', async () => {
    const deny: PolicyDecision = {
      allow: false,
      reason: 'five_hour_cap',
      resumeAt: new Date('2026-11-05T14:00:00Z'),
      capPct: 50,
    };
    const { engine, controller, done } = setup(async () => deny);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(engine.claimTask).not.toHaveBeenCalled();
    expect(engine.schedulerTick).toHaveBeenCalled();
    controller.abort();
    await done;
  });

  it('logs the denial once per change, with the reason and the resume time', async () => {
    const deny: PolicyDecision = {
      allow: false,
      reason: 'weekly_pacing',
      resumeAt: new Date('2026-11-05T14:00:00Z'),
    };
    const { controller, done } = setup(async () => deny);
    await vi.advanceTimersByTimeAsync(10_000);
    const lines = silent.info.mock.calls.filter(([m]) => String(m).includes('usage policy'));
    expect(lines).toHaveLength(1);
    expect(lines[0]![1]).toMatchObject({
      reason: 'weekly_pacing',
      resumeAt: '2026-11-05T14:00:00.000Z',
    });
    controller.abort();
    await done;
  });

  it('claims as soon as the policy allows again', async () => {
    let decision: PolicyDecision = {
      allow: false,
      reason: 'limit',
      resumeAt: new Date('2026-11-05T12:00:05Z'),
    };
    const { engine, controller, done } = setup(async () => decision);
    await vi.advanceTimersByTimeAsync(3000);
    expect(engine.claimTask).not.toHaveBeenCalled();
    decision = allow;
    await vi.advanceTimersByTimeAsync(3000);
    expect(engine.claimTask).toHaveBeenCalled();
    expect(engine.completeTask).toHaveBeenCalledWith('a', 'w1', expect.anything());
    controller.abort();
    await done;
  });

  it('wakes up at the resume time when it is sooner than the poll interval would suggest', async () => {
    const resumeAt = new Date('2026-11-05T12:00:02Z');
    let decision: PolicyDecision = { allow: false, reason: 'limit', resumeAt };
    const { engine, controller, done } = setup(
      async () => decision,
      config({ pollIntervalMs: 60_000 }),
    );
    await vi.advanceTimersByTimeAsync(100);
    decision = allow;
    await vi.advanceTimersByTimeAsync(2500);
    expect(engine.claimTask).toHaveBeenCalled(); // not after a full 60 s poll
    controller.abort();
    await done;
  });

  it('treats a policy error like any scheduler error: backs off and recovers', async () => {
    let calls = 0;
    const { engine, controller, done } = setup(async () => {
      if (++calls <= 2) throw new Error('db down');
      return allow;
    });
    await vi.advanceTimersByTimeAsync(30_000);
    expect(engine.claimTask).toHaveBeenCalled();
    expect(silent.warn).toHaveBeenCalled();
    controller.abort();
    await done;
  });
});
