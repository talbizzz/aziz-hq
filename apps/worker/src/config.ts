import { hostname } from 'node:os';
import { z } from 'zod';

const positiveInt = (fallback: number) => z.coerce.number().int().positive().default(fallback);

// Keys are the environment variable names so validation errors name them.
const envSchema = z.object({
  SUPABASE_URL: z.string().url(),
  SUPABASE_SECRET_KEY: z.string().min(1),
  WORKER_ID: z.string().min(1).optional(),
  WORKER_CONCURRENCY: positiveInt(2),
  POLL_INTERVAL_MS: positiveInt(2000),
  LEASE_SECONDS: positiveInt(120),
  HEARTBEAT_INTERVAL_MS: positiveInt(60_000),
  TASK_TIMEOUT_MS: positiveInt(2_700_000),
  SHUTDOWN_GRACE_MS: positiveInt(30_000),
});

export interface WorkerConfig {
  supabaseUrl: string;
  supabaseSecretKey: string;
  workerId: string;
  concurrency: number;
  pollIntervalMs: number;
  leaseSeconds: number;
  heartbeatIntervalMs: number;
  taskTimeoutMs: number;
  shutdownGraceMs: number;
}

export function loadConfig(env: Record<string, string | undefined> = process.env): WorkerConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`invalid worker configuration: ${problems}`);
  }
  const e = parsed.data;
  return {
    supabaseUrl: e.SUPABASE_URL,
    supabaseSecretKey: e.SUPABASE_SECRET_KEY,
    workerId: e.WORKER_ID ?? `${hostname()}-${process.pid}`,
    concurrency: e.WORKER_CONCURRENCY,
    pollIntervalMs: e.POLL_INTERVAL_MS,
    leaseSeconds: e.LEASE_SECONDS,
    heartbeatIntervalMs: e.HEARTBEAT_INTERVAL_MS,
    taskTimeoutMs: e.TASK_TIMEOUT_MS,
    shutdownGraceMs: e.SHUTDOWN_GRACE_MS,
  };
}
