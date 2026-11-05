import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../db/types.js';
import type { gateDecision } from '../domain/enums.js';
import type { z } from 'zod';
import type { TaskSpec } from './task-graph-spec.js';
import { validateTaskGraph } from './validate-task-graph.js';

export type Task = Database['public']['Tables']['tasks']['Row'];
export type GateDecision = z.infer<typeof gateDecision>;
export type EngineClient = Pick<SupabaseClient<Database>, 'rpc'>;

export class EngineError extends Error {
  constructor(
    readonly rpc: string,
    readonly code: string | undefined,
    message: string,
  ) {
    super(message);
    this.name = 'EngineError';
  }
}

type RawRpc = (
  fn: string,
  args: object,
) => PromiseLike<{ data: unknown; error: { message: string; code?: string } | null }>;

/** Thin, typed wrappers over the scheduler RPCs (supabase/schemas/23_*, 24_*). Use with a service-role client. */
export function createEngine(client: EngineClient) {
  const rpc = client.rpc.bind(client) as unknown as RawRpc;
  async function call<T>(name: string, args: object): Promise<T> {
    const { data, error } = await rpc(name, args);
    if (error) throw new EngineError(name, error.code, error.message);
    return data as T;
  }

  return {
    async createRun(input: {
      moduleId: string;
      title: string;
      config?: Record<string, unknown>;
      tasks?: TaskSpec[];
    }) {
      const tasks = input.tasks ?? [];
      validateTaskGraph(tasks);
      const out = await call<{ run_id: string; tasks: Record<string, string> }>('create_run', {
        p_module_id: input.moduleId,
        p_title: input.title,
        p_config: input.config ?? {},
        p_tasks: tasks,
      });
      return { runId: out.run_id, tasks: out.tasks };
    },

    async claimTask(workerId: string, leaseSeconds = 120): Promise<Task | null> {
      const rows = await call<Task[]>('claim_task', {
        p_worker_id: workerId,
        p_lease_seconds: leaseSeconds,
      });
      return rows[0] ?? null;
    },

    heartbeatTask: (taskId: string, workerId: string, leaseSeconds = 120) =>
      call<boolean>('heartbeat_task', {
        p_task_id: taskId,
        p_worker_id: workerId,
        p_lease_seconds: leaseSeconds,
      }),

    completeTask: (taskId: string, workerId: string, result: Record<string, unknown> = {}) =>
      call<boolean>('complete_task', {
        p_task_id: taskId,
        p_worker_id: workerId,
        p_result: result,
      }),

    failTask: (
      taskId: string,
      workerId: string,
      error: Record<string, unknown> = {},
      retryable = true,
    ) =>
      call<'retried' | 'failed' | 'ignored'>('fail_task', {
        p_task_id: taskId,
        p_worker_id: workerId,
        p_error: error,
        p_retryable: retryable,
      }),

    async schedulerTick() {
      const t = await call<{
        reaped: number;
        gates_opened: number;
        cancelled: number;
        runs_settled: number;
      }>('scheduler_tick', {});
      return {
        reaped: t.reaped,
        gatesOpened: t.gates_opened,
        cancelled: t.cancelled,
        runsSettled: t.runs_settled,
      };
    },

    async workerHeartbeat(workerId: string, info: Record<string, unknown> = {}) {
      await call<null>('worker_heartbeat', { p_worker_id: workerId, p_info: info });
    },

    releaseForLimit: (taskId: string, workerId: string, resetsAt: Date | null) =>
      call<boolean>('release_for_limit', {
        p_task_id: taskId,
        p_worker_id: workerId,
        p_resets_at: resetsAt ? resetsAt.toISOString() : null,
      }),

    recordUsageSnapshot: (input: {
      source: 'rate_limit_event' | 'estimate';
      fiveHour: { pct: number; resetsAt: Date };
      sevenDay: { pct: number; resetsAt: Date };
      runId?: string | null;
      taskId?: string | null;
    }) =>
      call<string>('record_usage_snapshot', {
        p_source: input.source,
        p_five_pct: input.fiveHour.pct,
        p_five_resets: input.fiveHour.resetsAt.toISOString(),
        p_seven_pct: input.sevenDay.pct,
        p_seven_resets: input.sevenDay.resetsAt.toISOString(),
        p_run_id: input.runId ?? null,
        p_task_id: input.taskId ?? null,
      }),

    async createTaskGraph(runId: string, tasks: TaskSpec[]) {
      validateTaskGraph(tasks);
      return call<Record<string, string>>('create_task_graph', { p_run_id: runId, p_tasks: tasks });
    },

    decideGate: (input: {
      taskId: string;
      decision: GateDecision;
      comment?: string | null;
      via?: 'dashboard' | 'telegram';
    }) =>
      call<{ first: boolean; decision: GateDecision }>('decide_gate', {
        p_task_id: input.taskId,
        p_decision: input.decision,
        p_comment: input.comment ?? null,
        p_via: input.via ?? 'dashboard',
      }),
  };
}

export type Engine = ReturnType<typeof createEngine>;
