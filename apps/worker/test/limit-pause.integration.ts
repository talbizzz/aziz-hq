import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  engineFor,
  resetData,
  serviceClient,
  spawnWorker,
  waitFor,
  type SpawnedWorker,
} from './support.js';

describe('the usage policy through a real worker (milestone 4)', () => {
  const workers: SpawnedWorker[] = [];
  beforeEach(async () => {
    await resetData();
    const db = serviceClient();
    await db.from('overrides').delete().not('id', 'is', null);
    await db.from('usage_snapshots').delete().not('id', 'is', null);
  });
  afterEach(async () => {
    await Promise.all(workers.splice(0).map((w) => w.stop()));
    // leave no snapshot or override behind: they would make the policy deny the other worker tests
    const db = serviceClient();
    await db.from('overrides').delete().not('id', 'is', null);
    await db.from('usage_snapshots').delete().not('id', 'is', null);
  });

  it('a limit result pauses claiming until the window resets, without consuming an attempt, then resumes by itself', async () => {
    const db = serviceClient();
    const { tasks } = await engineFor(db).createRun({
      moduleId: 'factory',
      title: 'limit run',
      tasks: [
        {
          key: 'work',
          type: 'agent',
          role: 'builder',
          title: 'work',
          payload: {
            fake: {
              outcomes: [
                // the limit applies for the first ~4 s (worker start-up included); the window is reported to reset at 8 s,
                // later than limitUntil so clock skew between the host and the Docker VM cannot matter
                {
                  status: 'limit',
                  limitUntil: new Date(Date.now() + 4000).toISOString(),
                  resetsAt: new Date(Date.now() + 8000).toISOString(),
                },
                { status: 'done' },
              ],
            },
          },
        },
      ],
    });
    const row = async () =>
      (await db.from('tasks').select('status, attempts').eq('id', tasks.work!).single()).data!;
    workers.push(spawnWorker('limit-worker'));

    // the first attempt hits the limit: the task is released and a limit override holds claims
    const limit = await waitFor(
      async () =>
        (
          await db
            .from('active_overrides')
            .select('kind, expires_at, created_by')
            .eq('kind', 'limit')
        ).data?.[0],
      { label: 'the limit override' },
    );
    expect(limit.created_by).toBe('system');
    expect(await row()).toEqual({ status: 'pending', attempts: 0 }); // the attempt was not consumed

    // while the override is active nothing is claimed
    await new Promise((r) => setTimeout(r, 2000));
    expect(await row()).toEqual({ status: 'pending', attempts: 0 });

    // after the window resets the worker resumes on its own and finishes the task
    await waitFor(async () => ((await row()).status === 'done' ? true : null), {
      timeoutMs: 30_000,
      label: 'the task to finish after the reset',
    });
    expect(await row()).toEqual({ status: 'done', attempts: 1 });
    const { data: events } = await db
      .from('events')
      .select('data')
      .eq('task_id', tasks.work!)
      .eq('kind', 'status_changed');
    expect(events!.some((e) => (e.data as { reason?: string }).reason === 'limit_hit')).toBe(true);
  });

  it('each override mode takes effect at the next claim: stop holds claims, clearing it resumes, working/sleeping/custom apply their caps', async () => {
    const db = serviceClient();
    const { tasks } = await engineFor(db).createRun({
      moduleId: 'factory',
      title: 'modes',
      tasks: [{ key: 'work', type: 'system', title: 'work' }],
    });
    const status = async () =>
      (await db.from('tasks').select('status').eq('id', tasks.work!).single()).data!.status;

    expect(
      (await db.rpc('set_mode_override', { p_kind: 'stop', p_via: 'telegram' })).error,
    ).toBeNull();
    workers.push(spawnWorker('mode-worker'));
    await new Promise((r) => setTimeout(r, 2500));
    expect(await status()).toBe('pending'); // stop: nothing is claimed

    // a snapshot at 60% of the five-hour window plus "working" (cap 50) still holds; "sleeping" (cap 100) lets it run
    const soon = new Date(Date.now() + 3 * 3_600_000).toISOString();
    const week = new Date(Date.now() + 6 * 86_400_000).toISOString();
    await db.rpc('record_usage_snapshot', {
      p_source: 'rate_limit_event',
      p_five_pct: 60,
      p_five_resets: soon,
      p_seven_pct: 5,
      p_seven_resets: week,
    });
    await db.rpc('set_mode_override', { p_kind: 'working', p_via: 'telegram' }); // newer than "stop": it wins
    await new Promise((r) => setTimeout(r, 2500));
    expect(await status()).toBe('pending'); // 60% >= the 50% work cap

    await db.rpc('set_mode_override', { p_kind: 'sleeping', p_via: 'telegram' }); // newest: cap 100
    await waitFor(async () => ((await status()) === 'done' ? true : null), {
      timeoutMs: 20_000,
      label: 'the task to run under "sleeping"',
    });
  });
});
