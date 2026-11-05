import { fakeRunSpec } from '@aziz-hq/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  engineFor,
  resetData,
  serviceClient,
  spawnWorker,
  waitFor,
  type SpawnedWorker,
} from './support.js';

describe('the scripted fake run (milestone 2 done criterion)', () => {
  const workers: SpawnedWorker[] = [];
  beforeEach(async () => resetData());
  afterEach(async () => {
    await Promise.all(workers.splice(0).map((w) => w.stop()));
  });

  it('parallel tasks, a failing-then-retried task, a gate and a crashed worker complete end to end', async () => {
    const client = serviceClient();
    const engine = engineFor(client);
    const { runId, tasks } = await engine.createRun({
      moduleId: 'factory',
      title: 'scripted fake run',
      tasks: fakeRunSpec({ crash: true }),
    });
    const row = async (key: string) =>
      (await client.from('tasks').select('*').eq('id', tasks[key]!).single()).data!;

    const a = spawnWorker('fake-a', { LEASE_SECONDS: '3' });
    const b = spawnWorker('fake-b', { LEASE_SECONDS: '3' });
    workers.push(a, b);

    // parallel tasks and the retry: build-a done, build-b done after a failed first attempt
    await waitFor(
      async () =>
        (await row('build-a')).status === 'done' && (await row('build-b')).status === 'done',
      { label: 'both builders to finish' },
    );
    expect((await row('build-b')).attempts).toBe(2);

    // the long task hangs on its first attempt; kill the worker that holds it
    const crashing = await waitFor(
      async () => {
        const t = await row('crash-me');
        return t.status === 'running' ? t : null;
      },
      { label: 'crash-me to be running' },
    );
    const victim = crashing.claimed_by === 'fake-a' ? a : b;
    victim.child.kill('SIGKILL');
    await new Promise((r) => victim.child.once('exit', r));

    // requirement 5: the gate is open, `ship` must not start while it (and crash-me) are unresolved
    const gate = await waitFor(
      async () => {
        const t = await row('review-gate');
        return t.status === 'waiting_human' ? t : null;
      },
      { label: 'the gate to open' },
    );
    expect((await row('ship')).status).toBe('pending');
    expect((await row('ship')).attempts).toBe(0);

    // the surviving worker reaps and re-runs the crashed task (requirement 6)
    await waitFor(async () => (await row('crash-me')).status === 'done', {
      timeoutMs: 45_000,
      label: 'crash-me to be recovered',
    });
    expect((await row('crash-me')).attempts).toBe(2);
    expect((await row('ship')).status).toBe('pending'); // still waiting for the human

    // decide the gate (idempotently), then the rest of the run follows
    expect(
      await engine.decideGate({
        taskId: gate.id,
        decision: 'approve',
        comment: 'ok',
        via: 'dashboard',
      }),
    ).toEqual({ first: true, decision: 'approve' });
    expect(
      await engine.decideGate({ taskId: gate.id, decision: 'approve', via: 'dashboard' }),
    ).toEqual({ first: false, decision: 'approve' });

    await waitFor(
      async () =>
        (await client.from('runs').select('status').eq('id', runId).single()).data!.status ===
        'done',
      { timeoutMs: 45_000, label: 'the run to be done' },
    );
    expect((await row('ship')).status).toBe('done');
    const { data: run } = await client.from('runs').select('finished_at').eq('id', runId).single();
    expect(run!.finished_at).not.toBeNull();

    // requirement 7: every status change is an event, with a plausible actor
    const { data: events } = await client
      .from('events')
      .select('*')
      .eq('run_id', runId)
      .order('id');
    const byTask = (key: string) => events!.filter((e) => e.task_id === tasks[key]);
    for (const key of Object.keys(tasks)) {
      expect(
        byTask(key).filter((e) => e.kind === 'created'),
        `${key} created`,
      ).toHaveLength(1);
      expect(
        byTask(key).some(
          (e) => e.kind === 'status_changed' && (e.data as { to?: string }).to === 'done',
        ),
        `${key} reached done`,
      ).toBe(true);
    }
    expect(byTask('build-b').some((e) => (e.data as { reason?: string }).reason === 'retry')).toBe(
      true,
    );
    expect(
      byTask('crash-me').some((e) => (e.data as { reason?: string }).reason === 'lease_expired'),
    ).toBe(true);
    expect(events!.filter((e) => e.kind === 'gate_decided')).toHaveLength(1);
    expect(events!.find((e) => e.kind === 'gate_decided')).toMatchObject({
      actor_type: 'human',
      actor_id: 'dashboard',
    });
    for (const e of events!) expect(['system', 'worker', 'agent', 'human']).toContain(e.actor_type);
    expect(events!.some((e) => e.kind === 'runner.fake.started' && e.actor_type === 'agent')).toBe(
      true,
    );
    expect(
      events!.filter((e) => e.entity_type === 'run' && (e.data as { to?: string }).to === 'done'),
    ).toHaveLength(1);
  });

  it('runs the plain scenario (no crash) with a single worker, and a dismissed gate cancels the rest', async () => {
    const client = serviceClient();
    const engine = engineFor(client);
    const { runId, tasks } = await engine.createRun({
      moduleId: 'factory',
      title: 'dismissed',
      tasks: fakeRunSpec(),
    });
    workers.push(spawnWorker('solo', { LEASE_SECONDS: '10' }));

    const gate = await waitFor(
      async () => {
        const t = (await client.from('tasks').select('*').eq('id', tasks['review-gate']!).single())
          .data!;
        return t.status === 'waiting_human' ? t : null;
      },
      { label: 'the gate to open' },
    );
    await engine.decideGate({ taskId: gate.id, decision: 'dismiss', via: 'telegram' });

    await waitFor(
      async () =>
        (await client.from('runs').select('status').eq('id', runId).single()).data!.status !==
        'running',
      { label: 'the run to settle' },
    );
    const { data: ship } = await client
      .from('tasks')
      .select('status, attempts')
      .eq('id', tasks.ship!)
      .single();
    expect(ship).toEqual({ status: 'cancelled', attempts: 0 });
    const { data: run } = await client.from('runs').select('status').eq('id', runId).single();
    expect(run!.status).toBe('done'); // everything that could run did; the rest was cancelled
  });
});
