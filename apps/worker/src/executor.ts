import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Runner } from '@aziz-hq/agents-sdk';
import type { Task } from '@aziz-hq/core';
import type { WorkerConfig } from './config.js';
import type { EventSink, Logger, WorkerEngine } from './engine.js';

export type ExecuteOutcome = 'done' | 'failed' | 'lease_lost';

export interface ExecutorDeps {
  engine: Pick<WorkerEngine, 'heartbeatTask' | 'completeTask' | 'failTask'>;
  runner: Runner;
  events: EventSink;
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
  const { engine, runner, events, config, log } = deps;
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
    const outcome = await engine.failTask(task.id, config.workerId, error, retryable);
    return outcome === 'ignored' ? 'lease_lost' : 'failed';
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

    if (result.status === 'done') {
      const ok = await engine.completeTask(task.id, config.workerId, {
        summary: result.summary,
        costUsd: result.costUsd,
      });
      return ok ? 'done' : 'lease_lost';
    }
    if (result.status === 'needs_human') {
      return fail({ kind: 'needs_human', message: result.summary }, false);
    }
    return fail({ kind: 'runner_failed', message: result.summary }, true);
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
