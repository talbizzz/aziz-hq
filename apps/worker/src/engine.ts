import type { Engine, Task } from '@aziz-hq/core';
import type { RunnerResult } from '@aziz-hq/agents-sdk';

export type WorkerEngine = Pick<
  Engine,
  'claimTask' | 'heartbeatTask' | 'completeTask' | 'failTask' | 'schedulerTick' | 'workerHeartbeat'
>;

export type RunnerEvent = RunnerResult['events'][number];
export type EventSink = (task: Task, events: RunnerEvent[]) => Promise<void>;

export interface Logger {
  info(msg: string, data?: Record<string, unknown>): void;
  warn(msg: string, data?: Record<string, unknown>): void;
  error(msg: string, data?: Record<string, unknown>): void;
}
