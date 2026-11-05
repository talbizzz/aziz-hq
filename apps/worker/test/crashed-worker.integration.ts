import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  engineFor,
  resetData,
  serviceClient,
  spawnWorker,
  waitFor,
  type SpawnedWorker,
} from './support.js';

describe('a crashed worker (requirement 6)', () => {
  const workers: SpawnedWorker[] = [];
  beforeEach(async () => resetData());
  afterEach(async () => {
    await Promise.all(workers.splice(0).map((w) => w.stop()));
  });

  it('loses its lease on SIGKILL; the task is reaped, retried by another worker and completes', async () => {
    const client = serviceClient();
    const { runId, tasks } = await engineFor(client).createRun({
      moduleId: 'factory',
      title: 'crash',
      tasks: [
        {
          key: 'work',
          type: 'agent',
          role: 'builder',
          title: 'work',
          // attempt 1 hangs (the worker dies during it), attempt 2 succeeds
          payload: {
            fake: {
              outcomes: [
                { status: 'done', hang: true },
                { status: 'done', summary: 'recovered' },
              ],
            },
          },
        },
      ],
    });
    const taskId = tasks.work!;
    const task = async () =>
      (await client.from('tasks').select('*').eq('id', taskId).single()).data!;

    const a = spawnWorker('crash-a', { LEASE_SECONDS: '3' });
    workers.push(a);
    await waitFor(
      async () => (await task()).claimed_by === 'crash-a' && (await task()).status === 'running',
      { label: 'worker A to claim the task' },
    );

    a.child.kill('SIGKILL'); // no chance to release anything
    await new Promise((r) => a.child.once('exit', r));
    expect((await task()).status).toBe('running'); // still leased, nobody knows A died

    const b = spawnWorker('crash-b', { LEASE_SECONDS: '3' });
    workers.push(b);
    const done = await waitFor(
      async () => ((await task()).status === 'done' ? await task() : null),
      {
        timeoutMs: 45_000,
        label: 'worker B to finish the reaped task',
      },
    );

    expect(done.attempts).toBe(2);
    expect(done.claimed_by).toBe('crash-b');
    expect(done.result).toMatchObject({ summary: 'recovered' });

    const { data: events } = await client
      .from('events')
      .select('actor_type, actor_id, data')
      .eq('task_id', taskId)
      .eq('kind', 'status_changed')
      .order('id');
    const reaped = events!.find((e) => (e.data as { reason?: string }).reason === 'lease_expired');
    expect(reaped).toMatchObject({ actor_type: 'system', actor_id: 'reaper' });

    const { data: run } = await client.from('runs').select('status').eq('id', runId).single();
    await waitFor(
      async () =>
        (await client.from('runs').select('status').eq('id', runId).single()).data!.status ===
        'done',
      { label: 'run to settle' },
    );
    expect(run).toBeTruthy();
  });
});
