import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeRunner } from './fake-runner.js';
import { runnerResultSchema, type RunnerInput } from './runner.js';

const input = (
  payload: Record<string, unknown>,
  attempt = 1,
  signal = new AbortController().signal,
): RunnerInput => ({
  role: 'builder',
  task: { id: 't1', runId: 'r1', title: 'T', payload, attempt },
  context: {},
  workdir: '/tmp/work',
  budget: { timeoutMs: 60_000 },
  signal,
});

describe('FakeRunner', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('is named fake and succeeds by default at zero cost', async () => {
    const runner = new FakeRunner();
    expect(runner.name).toBe('fake');
    const result = await runner.run(input({}));
    expect(result.status).toBe('done');
    expect(result.costUsd).toBe(0);
    expect(runnerResultSchema.safeParse(result).success).toBe(true);
    expect(result.events.map((e) => e.kind)).toEqual(['fake.started', 'fake.finished']);
  });

  it('uses the outcome for the attempt and repeats the last one', async () => {
    const payload = {
      fake: { outcomes: [{ status: 'failed', summary: 'nope' }, { status: 'done' }] },
    };
    const runner = new FakeRunner();
    expect((await runner.run(input(payload, 1))).status).toBe('failed');
    expect((await runner.run(input(payload, 1))).summary).toBe('nope');
    expect((await runner.run(input(payload, 2))).status).toBe('done');
    expect((await runner.run(input(payload, 5))).status).toBe('done');
  });

  it('supports needs_human outcomes', async () => {
    const result = await new FakeRunner().run(
      input({ fake: { outcomes: [{ status: 'needs_human', summary: 'which colour?' }] } }),
    );
    expect(result).toMatchObject({ status: 'needs_human', summary: 'which colour?' });
  });

  it('waits for delayMs', async () => {
    const promise = new FakeRunner().run(input({ fake: { delayMs: 1000 } }));
    let settled = false;
    void promise.then(() => (settled = true));
    await vi.advanceTimersByTimeAsync(999);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await promise;
    expect(settled).toBe(true);
  });

  it('rejects when aborted during the delay', async () => {
    const controller = new AbortController();
    const promise = new FakeRunner().run(
      input({ fake: { delayMs: 60_000 } }, 1, controller.signal),
    );
    const assertion = expect(promise).rejects.toThrow('stopped');
    controller.abort(new Error('stopped'));
    await assertion;
  });

  it('hang never resolves on its own and rejects when the signal aborts', async () => {
    const controller = new AbortController();
    const promise = new FakeRunner().run(
      input({ fake: { outcomes: [{ status: 'done', hang: true }] } }, 1, controller.signal),
    );
    let settled = false;
    promise.then(
      () => (settled = true),
      () => (settled = true),
    );
    await vi.advanceTimersByTimeAsync(3_600_000);
    expect(settled).toBe(false);
    const assertion = expect(promise).rejects.toThrow('timeout');
    controller.abort(new Error('timeout'));
    await assertion;
  });

  it('rejects immediately when already aborted', async () => {
    const controller = new AbortController();
    controller.abort(new Error('already'));
    await expect(new FakeRunner().run(input({}, 1, controller.signal))).rejects.toThrow('already');
  });

  it('rejects an invalid payload.fake with a clear error', async () => {
    const runner = new FakeRunner();
    await expect(runner.run(input({ fake: { outcomes: [{ status: 'maybe' }] } }))).rejects.toThrow(
      /invalid payload\.fake/,
    );
    await expect(runner.run(input({ fake: { delayMs: -1 } }))).rejects.toThrow(
      /invalid payload\.fake/,
    );
    await expect(runner.run(input({ fake: { outcomes: [] } }))).rejects.toThrow(
      /invalid payload\.fake/,
    );
  });
});
