import type { Engine, Task } from '@aziz-hq/core';
import type { RunnerResult } from '@aziz-hq/agents-sdk';

export type WorkerEngine = Pick<
  Engine,
  | 'claimTask'
  | 'heartbeatTask'
  | 'completeTask'
  | 'failTask'
  | 'schedulerTick'
  | 'workerHeartbeat'
  | 'releaseForLimit'
  | 'recordUsageSnapshot'
  | 'createTaskGraph'
>;

export type RunnerEvent = RunnerResult['events'][number];
export type EventSink = (task: Task, events: RunnerEvent[]) => Promise<void>;

export interface Logger {
  info(msg: string, data?: Record<string, unknown>): void;
  warn(msg: string, data?: Record<string, unknown>): void;
  error(msg: string, data?: Record<string, unknown>): void;
}

/** Side effects of a finished run that are not scheduler state: usage rows, transcripts and escalation gates. */
export interface RunRecorder {
  usage(task: Task, runner: string, usage: NonNullable<RunnerResult['usage']>): Promise<void>;
  transcript(task: Task, text: string): Promise<void>;
  /** Opens an `escalation` gate with the evidence when a task fails for good (milestone 4, C5). */
  escalate(task: Task, evidence: Record<string, unknown>): Promise<void>;
}
