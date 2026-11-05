import type { RunnerConfig, RunnerRegistry } from '@aziz-hq/agents-sdk';
import type { PolicyDecision } from '@aziz-hq/core';
import type { WorkerConfig } from './config.js';
import type { EventSink, Logger, RunRecorder, WorkerEngine } from './engine.js';
import { executeTask } from './executor.js';

export interface LoopDeps {
  engine: WorkerEngine;
  runners: RunnerRegistry;
  runnerConfig: RunnerConfig;
  events: EventSink;
  recorder?: RunRecorder;
  /** The usage policy (ADR-15); evaluated before every claim. Without it nothing is held back. */
  policy?: () => Promise<PolicyDecision>;
  config: WorkerConfig;
  log: Logger;
}

/** Resolves after `ms`, or as soon as `signal` aborts. */
const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve) => {
    if (signal?.aborted) return resolve();
    const timer = setTimeout(done, ms);
    function done() {
      clearTimeout(timer);
      signal?.removeEventListener('abort', done);
      resolve();
    }
    signal?.addEventListener('abort', done, { once: true });
  });

/**
 * The worker loop: every iteration runs the scheduler tick (reaper, gates, run settling) and claims tasks up to the
 * concurrency. RPC failures back off exponentially (capped) and never end the loop. On shutdown it stops claiming, waits
 * for running tasks up to the grace period, then releases them so another worker can pick them up immediately.
 */
export async function runWorker(deps: LoopDeps, signal: AbortSignal): Promise<void> {
  const { engine, runners, runnerConfig, events, recorder, policy, config, log } = deps;
  const active = new Set<Promise<unknown>>();
  const taskShutdown = new AbortController();

  const heartbeat = async () => {
    try {
      await engine.workerHeartbeat(config.workerId, { concurrency: config.concurrency });
    } catch (e) {
      log.warn('worker heartbeat failed', { error: String(e) });
    }
  };
  void heartbeat();
  const heartbeatTimer = setInterval(() => void heartbeat(), config.heartbeatIntervalMs);

  let errorDelay = 0;
  let lastPolicyKey = '';
  while (!signal.aborted) {
    let claimed = false;
    let denyWaitMs: number | null = null;
    try {
      await engine.schedulerTick();

      // The usage policy gates claiming only: running tasks and the scheduler tick carry on (ADR-15).
      let allowed = true;
      if (policy) {
        const decision = await policy();
        allowed = decision.allow;
        const key = decision.allow
          ? 'allow'
          : `${decision.reason}|${decision.resumeAt?.toISOString() ?? ''}`;
        if (key !== lastPolicyKey) {
          lastPolicyKey = key;
          if (decision.allow)
            log.info('usage policy allows claiming', {
              capPct: decision.capPct,
              reason: decision.reason,
            });
          else
            log.info('usage policy denies claiming', {
              reason: decision.reason,
              resumeAt: decision.resumeAt?.toISOString() ?? null,
            });
        }
        if (!decision.allow) {
          const untilResume = decision.resumeAt
            ? decision.resumeAt.getTime() - Date.now()
            : config.pollIntervalMs;
          denyWaitMs = Math.min(config.pollIntervalMs, Math.max(250, untilResume));
        }
      }

      while (allowed && active.size < config.concurrency && !signal.aborted) {
        const task = await engine.claimTask(config.workerId, config.leaseSeconds);
        if (!task) break;
        claimed = true;

        let runner;
        try {
          runner = runners.forRole(task.role ?? task.type, runnerConfig);
        } catch (e) {
          log.error('no runner for task', { task: task.id, error: String(e) });
          await engine.failTask(
            task.id,
            config.workerId,
            { kind: 'config_error', message: String(e) },
            false,
          );
          continue;
        }

        const running: Promise<unknown> = executeTask(
          { engine, runner, events, recorder, config, log },
          task,
          taskShutdown.signal,
        )
          .then((outcome) => log.info('task finished', { task: task.id, outcome }))
          .catch((e: unknown) => log.error('task crashed', { task: task.id, error: String(e) }))
          .finally(() => active.delete(running));
        active.add(running);
      }
      errorDelay = 0;
    } catch (e) {
      errorDelay = Math.min(errorDelay ? errorDelay * 2 : 1000, 30_000);
      log.warn('scheduler call failed, backing off', { error: String(e), retryInMs: errorDelay });
    }

    if (signal.aborted) break;
    const wait =
      errorDelay ||
      denyWaitMs ||
      (claimed && active.size < config.concurrency ? 0 : config.pollIntervalMs);
    if (wait > 0) await sleep(wait, signal);
  }

  clearInterval(heartbeatTimer);
  if (active.size > 0) {
    log.info('shutting down, waiting for running tasks', {
      running: active.size,
      graceMs: config.shutdownGraceMs,
    });
    await Promise.race([Promise.allSettled([...active]), sleep(config.shutdownGraceMs)]);
    taskShutdown.abort(new Error('shutdown'));
    await Promise.allSettled([...active]);
  }
}
