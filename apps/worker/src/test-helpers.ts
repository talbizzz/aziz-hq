import { vi, type Mock } from 'vitest';
import type { Task } from '@aziz-hq/core';
import type { WorkerConfig } from './config.js';
import type { WorkerEngine } from './engine.js';

export const config = (over: Partial<WorkerConfig> = {}): WorkerConfig => ({
  supabaseUrl: 'http://x.test',
  supabaseSecretKey: 'k',
  workerId: 'w1',
  concurrency: 2,
  pollIntervalMs: 1000,
  leaseSeconds: 30,
  heartbeatIntervalMs: 60_000,
  taskTimeoutMs: 600_000,
  shutdownGraceMs: 5000,
  ...over,
});

export const task = (over: Partial<Task> = {}): Task =>
  ({
    id: 't1',
    run_id: 'r1',
    type: 'agent',
    role: 'builder',
    title: 'T',
    status: 'running',
    depends_on: [],
    attempts: 1,
    max_attempts: 3,
    lease_until: null,
    claimed_by: 'w1',
    priority: 0,
    lane: null,
    payload: {},
    result: null,
    created_at: '',
    updated_at: '',
    ...over,
  }) as Task;

export type FakeEngine = { [K in keyof WorkerEngine]: Mock<WorkerEngine[K]> };

export function fakeEngine(
  over: Partial<{ [K in keyof WorkerEngine]: Mock<WorkerEngine[K]> | WorkerEngine[K] }> = {},
): FakeEngine {
  const engine = {
    claimTask: vi.fn(async () => null),
    heartbeatTask: vi.fn(async () => true),
    completeTask: vi.fn(async () => true),
    failTask: vi.fn(async () => 'failed' as const),
    schedulerTick: vi.fn(async () => ({ reaped: 0, gatesOpened: 0, cancelled: 0, runsSettled: 0 })),
    workerHeartbeat: vi.fn(async () => undefined),
    ...over,
  };
  return engine as unknown as FakeEngine;
}
