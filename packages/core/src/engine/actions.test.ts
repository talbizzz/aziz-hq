import { describe, expect, it, vi } from 'vitest';
import { EngineError, createEngine, type EngineClient } from './actions.js';

type Reply = { data: unknown; error: { message: string; code?: string } | null };

function fakeClient(reply: Reply) {
  const rpc = vi.fn(async () => reply);
  return { client: { rpc } as unknown as EngineClient, rpc };
}
const ok = (data: unknown): Reply => ({ data, error: null });
const taskRow = { id: 't1', run_id: 'r1', title: 'x' };

describe('createEngine', () => {
  it('createRun maps arguments and the response', async () => {
    const { client, rpc } = fakeClient(ok({ run_id: 'r1', tasks: { a: 't1' } }));
    const out = await createEngine(client).createRun({
      moduleId: 'factory',
      title: 'T',
      config: { k: 1 },
      tasks: [{ key: 'a', type: 'system', title: 'A' }],
    });
    expect(rpc).toHaveBeenCalledWith('create_run', {
      p_module_id: 'factory',
      p_title: 'T',
      p_config: { k: 1 },
      p_tasks: [{ key: 'a', type: 'system', title: 'A' }],
    });
    expect(out).toEqual({ runId: 'r1', tasks: { a: 't1' } });
  });

  it('createRun validates the graph on the client before calling the database', async () => {
    const { client, rpc } = fakeClient(ok(null));
    await expect(
      createEngine(client).createRun({
        moduleId: 'factory',
        title: 'T',
        tasks: [{ key: 'a', type: 'agent', title: 'A' }],
      }),
    ).rejects.toThrowError('agent task needs a role: a');
    expect(rpc).not.toHaveBeenCalled();
  });

  it('claimTask returns the task or null', async () => {
    const some = fakeClient(ok([taskRow]));
    expect(await createEngine(some.client).claimTask('w1', 30)).toEqual(taskRow);
    expect(some.rpc).toHaveBeenCalledWith('claim_task', { p_worker_id: 'w1', p_lease_seconds: 30 });
    const none = fakeClient(ok([]));
    expect(await createEngine(none.client).claimTask('w1')).toBeNull();
    expect(none.rpc).toHaveBeenCalledWith('claim_task', {
      p_worker_id: 'w1',
      p_lease_seconds: 120,
    });
  });

  it('heartbeat, complete and fail map arguments and results', async () => {
    const hb = fakeClient(ok(true));
    expect(await createEngine(hb.client).heartbeatTask('t1', 'w1', 60)).toBe(true);
    expect(hb.rpc).toHaveBeenCalledWith('heartbeat_task', {
      p_task_id: 't1',
      p_worker_id: 'w1',
      p_lease_seconds: 60,
    });

    const done = fakeClient(ok(false));
    expect(await createEngine(done.client).completeTask('t1', 'w1', { summary: 's' })).toBe(false);
    expect(done.rpc).toHaveBeenCalledWith('complete_task', {
      p_task_id: 't1',
      p_worker_id: 'w1',
      p_result: { summary: 's' },
    });

    const fail = fakeClient(ok('retried'));
    expect(await createEngine(fail.client).failTask('t1', 'w1', { message: 'm' }, false)).toBe(
      'retried',
    );
    expect(fail.rpc).toHaveBeenCalledWith('fail_task', {
      p_task_id: 't1',
      p_worker_id: 'w1',
      p_error: { message: 'm' },
      p_retryable: false,
    });
  });

  it('schedulerTick renames the counters', async () => {
    const { client } = fakeClient(
      ok({ reaped: 1, gates_opened: 2, cancelled: 3, runs_settled: 4 }),
    );
    expect(await createEngine(client).schedulerTick()).toEqual({
      reaped: 1,
      gatesOpened: 2,
      cancelled: 3,
      runsSettled: 4,
    });
  });

  it('workerHeartbeat and decideGate map arguments', async () => {
    const hb = fakeClient(ok(null));
    await createEngine(hb.client).workerHeartbeat('w1', { v: 1 });
    expect(hb.rpc).toHaveBeenCalledWith('worker_heartbeat', {
      p_worker_id: 'w1',
      p_info: { v: 1 },
    });

    const gate = fakeClient(ok({ first: true, decision: 'approve' }));
    expect(
      await createEngine(gate.client).decideGate({
        taskId: 't1',
        decision: 'approve',
        via: 'telegram',
      }),
    ).toEqual({
      first: true,
      decision: 'approve',
    });
    expect(gate.rpc).toHaveBeenCalledWith('decide_gate', {
      p_task_id: 't1',
      p_decision: 'approve',
      p_comment: null,
      p_via: 'telegram',
    });
  });

  it('turns RPC errors into EngineError with the rpc name and code', async () => {
    const { client } = fakeClient({
      data: null,
      error: { message: 'gate is not open', code: '22023' },
    });
    const err = await createEngine(client)
      .decideGate({ taskId: 't1', decision: 'approve' })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(EngineError);
    expect(err).toMatchObject({ rpc: 'decide_gate', code: '22023', message: 'gate is not open' });
  });
});

describe('createEngine: usage policy and escalation (milestone 4)', () => {
  it('releaseForLimit maps arguments, including a missing reset time', async () => {
    const a = fakeClient(ok(true));
    expect(
      await createEngine(a.client).releaseForLimit('t1', 'w1', new Date('2026-11-05T15:00:00Z')),
    ).toBe(true);
    expect(a.rpc).toHaveBeenCalledWith('release_for_limit', {
      p_task_id: 't1',
      p_worker_id: 'w1',
      p_resets_at: '2026-11-05T15:00:00.000Z',
    });
    const b = fakeClient(ok(false));
    expect(await createEngine(b.client).releaseForLimit('t1', 'w1', null)).toBe(false);
    expect(b.rpc).toHaveBeenCalledWith('release_for_limit', {
      p_task_id: 't1',
      p_worker_id: 'w1',
      p_resets_at: null,
    });
  });

  it('recordUsageSnapshot maps the two windows', async () => {
    const { client, rpc } = fakeClient(ok('snap-1'));
    const id = await createEngine(client).recordUsageSnapshot({
      source: 'rate_limit_event',
      fiveHour: { pct: 15, resetsAt: new Date('2026-11-05T15:00:00Z') },
      sevenDay: { pct: 9, resetsAt: new Date('2026-11-08T04:00:00Z') },
      runId: 'r1',
      taskId: 't1',
    });
    expect(id).toBe('snap-1');
    expect(rpc).toHaveBeenCalledWith('record_usage_snapshot', {
      p_source: 'rate_limit_event',
      p_five_pct: 15,
      p_five_resets: '2026-11-05T15:00:00.000Z',
      p_seven_pct: 9,
      p_seven_resets: '2026-11-08T04:00:00.000Z',
      p_run_id: 'r1',
      p_task_id: 't1',
    });
  });

  it('createTaskGraph validates on the client first and returns the ids by key', async () => {
    const { client, rpc } = fakeClient(ok({ a: 'id-a' }));
    expect(
      await createEngine(client).createTaskGraph('r1', [{ key: 'a', type: 'system', title: 'A' }]),
    ).toEqual({ a: 'id-a' });
    expect(rpc).toHaveBeenCalledWith('create_task_graph', {
      p_run_id: 'r1',
      p_tasks: [{ key: 'a', type: 'system', title: 'A' }],
    });
    await expect(
      createEngine(client).createTaskGraph('r1', [{ key: 'a', type: 'agent', title: 'A' }]),
    ).rejects.toThrowError('agent task needs a role: a');
  });
});
