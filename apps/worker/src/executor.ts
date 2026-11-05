import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Runner } from '@aziz-hq/agents-sdk';
import type { Task } from '@aziz-hq/core';
import type { WorkerConfig } from './config.js';
import type { EventSink, Logger, RunRecorder, WorkerEngine } from './engine.js';

export type ExecuteOutcome = 'done' | 'failed' | 'limit' | 'lease_lost';

// Retrying cannot fix these (a logged-out CLI, a bad task, a guard violation): fail for good and escalate.
const NON_RETRYABLE = new Set(['auth', 'config', 'protected_tests', 'out_of_scope', 'guard_error']);

export interface ExecutorDeps {
  engine: Pick<
    WorkerEngine,
    'heartbeatTask' | 'completeTask' | 'failTask' | 'releaseForLimit' | 'recordUsageSnapshot'
  >;
  runner: Runner;
  events: EventSink;
  /** Usage rows, transcripts and escalation gates; optional (the FakeRunner needs none). */
  recorder?: RunRecorder;
  config: WorkerConfig;
  log: Logger;
}

class TimeoutError extends Error {}
class ShutdownError extends Error {}

/**
 * Runs one claimed task: renews the lease while the runner works, enforces the wall-clock timeout, and reports the
 * result. A lost lease (another worker owns the task now) drops the result silently.
 */
export async function executeTask(
  deps: ExecutorDeps,
  task: Task,
  shutdown: AbortSignal,
): Promise<ExecuteOutcome> {
  const { engine, runner, events, recorder, config, log } = deps;
  const control = new AbortController();
  let leaseLost = false;

  const onShutdown = () => control.abort(new ShutdownError('worker is shutting down'));
  if (shutdown.aborted) onShutdown();
  else shutdown.addEventListener('abort', onShutdown, { once: true });

  const lease = setInterval(
    () => {
      engine.heartbeatTask(task.id, config.workerId, config.leaseSeconds).then(
        (ok) => {
          if (!ok && !control.signal.aborted) {
            leaseLost = true;
            control.abort(new Error('lease lost'));
          }
        },
        (e: unknown) => log.warn('lease renewal failed', { task: task.id, error: String(e) }),
      );
    },
    (config.leaseSeconds * 1000) / 3,
  );
  const timeout = setTimeout(
    () => control.abort(new TimeoutError(`task exceeded ${config.taskTimeoutMs} ms`)),
    config.taskTimeoutMs,
  );

  const fail = async (
    error: Record<string, unknown>,
    retryable: boolean,
  ): Promise<ExecuteOutcome> => {
    // A final failure escalates to a gate for the owner. Escalate before failing so the gate exists when the run settles.
    const final = !retryable || task.attempts >= task.max_attempts;
    if (final && recorder && error.kind !== 'shutdown') {
      try {
        await recorder.escalate(task, {
          errorKind: String(error.kind),
          summary: String(error.message ?? ''),
          attempt: task.attempts,
          maxAttempts: task.max_attempts,
        });
      } catch (e) {
        log.warn('could not escalate', { task: task.id, error: String(e) });
      }
    }
    const outcome = await engine.failTask(task.id, config.workerId, error, retryable);
    return outcome === 'ignored' ? 'lease_lost' : 'failed';
  };

  const guarded = async (what: string, run: () => Promise<unknown>) => {
    try {
      await run();
    } catch (e) {
      log.warn(`could not record ${what}`, { task: task.id, error: String(e) });
    }
  };

  try {
    const result = await runner.run({
      role: task.role ?? task.type,
      task: {
        id: task.id,
        runId: task.run_id,
        title: task.title,
        payload: task.payload as Record<string, unknown>,
        attempt: task.attempts,
      },
      context: {},
      workdir: join(tmpdir(), 'aziz-hq', task.id),
      budget: { timeoutMs: config.taskTimeoutMs },
      signal: control.signal,
    });

    if (leaseLost) return 'lease_lost';

    try {
      await events(
        task,
        result.events.map((e) => ({ kind: `runner.${e.kind}`, data: e.data })),
      );
    } catch (e) {
      log.warn('could not record runner events', { task: task.id, error: String(e) });
    }

    // usage and transcripts are recorded for every outcome, including limits and failures; none of it can fail the task
    if (result.usage && recorder)
      await guarded('usage', () => recorder.usage(task, runner.name, result.usage!));
    if (result.rateLimit) {
      const { fiveHour, sevenDay } = result.rateLimit;
      await guarded('usage snapshot', () =>
        engine.recordUsageSnapshot({
          source: 'rate_limit_event',
          fiveHour: { pct: fiveHour.pct, resetsAt: fiveHour.resetsAt },
          sevenDay: { pct: sevenDay.pct, resetsAt: sevenDay.resetsAt },
          runId: task.run_id,
          taskId: task.id,
        }),
      );
    }
    if (result.transcript && recorder)
      await guarded('transcript', () => recorder.transcript(task, result.transcript!));

    if (result.status === 'done') {
      const ok = await engine.completeTask(task.id, config.workerId, {
        summary: result.summary,
        costUsd: result.costUsd,
      });
      return ok ? 'done' : 'lease_lost';
    }
    if (result.status === 'limit') {
      // a plan limit is a pause, not a failure: the task goes back to pending without consuming the attempt
      const released = await engine.releaseForLimit(
        task.id,
        config.workerId,
        result.resetsAt ?? null,
      );
      return released ? 'limit' : 'lease_lost';
    }
    if (result.status === 'needs_human') {
      return fail({ kind: 'needs_human', message: result.summary }, false);
    }
    const kind = result.errorKind ?? 'runner_failed';
    return fail({ kind, message: result.summary }, !NON_RETRYABLE.has(kind));
  } catch (err) {
    if (leaseLost) return 'lease_lost';
    const reason = control.signal.aborted ? (control.signal.reason as unknown) : undefined;
    if (reason instanceof TimeoutError)
      return fail({ kind: 'timeout', message: reason.message }, true);
    if (reason instanceof ShutdownError)
      return fail({ kind: 'shutdown', message: reason.message }, true);
    return fail(
      { kind: 'runner_error', message: err instanceof Error ? err.message : String(err) },
      true,
    );
  } finally {
    clearInterval(lease);
    clearTimeout(timeout);
    shutdown.removeEventListener('abort', onShutdown);
  }
}
