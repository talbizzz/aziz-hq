import { beforeEach, describe, expect, it } from 'vitest';
import { engineFor, resetData, serviceClient } from './support.js';

describe('claim_task under concurrency (requirement 5)', () => {
  beforeEach(async () => resetData());

  it('the plain supabase-js client works with an sb_secret_ key', async () => {
    const out = await engineFor().createRun({
      moduleId: 'factory',
      title: 'smoke',
      tasks: [{ key: 'a', type: 'system', title: 'A' }],
    });
    expect(out.runId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('claims every task exactly once with several workers racing', async () => {
    const engine = engineFor();
    const total = 20;
    const { runId, tasks } = await engine.createRun({
      moduleId: 'factory',
      title: 'race',
      tasks: Array.from({ length: total }, (_, i) => ({
        key: `k${i}`,
        type: 'system' as const,
        title: `t${i}`,
      })),
    });
    expect(Object.keys(tasks)).toHaveLength(total);

    const claimed: { worker: string; id: string }[] = [];
    await Promise.all(
      Array.from({ length: 5 }, async (_, w) => {
        const workerEngine = engineFor(serviceClient()); // its own connection
        for (;;) {
          const task = await workerEngine.claimTask(`racer-${w}`);
          if (!task) return;
          claimed.push({ worker: `racer-${w}`, id: task.id });
        }
      }),
    );

    const ids = claimed.map((c) => c.id);
    expect(ids).toHaveLength(total);
    expect(new Set(ids).size).toBe(total); // none claimed twice
    expect(new Set(ids)).toEqual(new Set(Object.values(tasks)));

    const { data } = await serviceClient()
      .from('tasks')
      .select('status, attempts')
      .eq('run_id', runId);
    expect(data!.every((t) => t.status === 'running' && t.attempts === 1)).toBe(true);
    expect(new Set(claimed.map((c) => c.worker)).size).toBeGreaterThan(1); // the race really was shared
  });

  it('claims dependent tasks only after their dependencies are done, with many workers', async () => {
    const engine = engineFor();
    const { tasks } = await engine.createRun({
      moduleId: 'factory',
      title: 'chain',
      tasks: [
        { key: 'a', type: 'system', title: 'a' },
        { key: 'b', type: 'system', title: 'b', depends_on: ['a'] },
        { key: 'c', type: 'system', title: 'c', depends_on: ['b'] },
      ],
    });
    const results = await Promise.all(
      Array.from({ length: 5 }, (_, i) => engineFor(serviceClient()).claimTask(`w${i}`)),
    );
    const got = results.filter(Boolean);
    expect(got).toHaveLength(1);
    expect(got[0]!.id).toBe(tasks.a);
  });
});
