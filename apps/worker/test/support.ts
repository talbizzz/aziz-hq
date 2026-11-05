import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { join } from 'node:path';
import { createEngine, type Database } from '@aziz-hq/core';
import { createClient } from '@supabase/supabase-js';

export const repoRoot = join(import.meta.dirname, '../../..');

export interface LocalSupabase {
  url: string;
  secretKey: string;
  publishableKey: string;
}

// Endpoints and keys of the running local stack (local development keys only).
export function localSupabase(): LocalSupabase {
  const out = execFileSync('supabase', ['status', '-o', 'json'], {
    encoding: 'utf8',
    cwd: repoRoot,
  });
  const s = JSON.parse(out.slice(out.indexOf('{'))) as Record<string, string>;
  return { url: s.API_URL!, secretKey: s.SECRET_KEY!, publishableKey: s.PUBLISHABLE_KEY! };
}

// Deliberately the plain supabase-js client with an sb_secret_ key (no fetch wrapper): the first test proves it works.
export function serviceClient(local = localSupabase()) {
  return createClient<Database>(local.url, local.secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export const engineFor = (client = serviceClient()) => createEngine(client);

/** Removes all run data (runs cascade to tasks and gates; events are append-only and stay) so tests start clean. */
export async function resetData(client = serviceClient()) {
  for (const table of ['runs', 'worker_heartbeats'] as const) {
    const column = table === 'runs' ? 'id' : 'worker_id';
    const { error } = await client.from(table).delete().not(column, 'is', null);
    if (error) throw new Error(`reset ${table}: ${error.message}`);
  }
}

export async function waitFor<T>(
  fn: () => Promise<T | null | undefined | false>,
  { timeoutMs = 30_000, intervalMs = 250, label = 'condition' } = {},
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await fn();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${label}`);
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

export interface SpawnedWorker {
  child: ChildProcess;
  output: string[];
  stop(): Promise<void>;
}

/** Starts a real worker process (node + tsx, no wrapper, so SIGKILL really kills it). */
export function spawnWorker(workerId: string, env: Record<string, string> = {}): SpawnedWorker {
  const local = localSupabase();
  const child = spawn(process.execPath, ['--import', 'tsx', 'apps/worker/src/main.ts'], {
    cwd: repoRoot,
    env: {
      ...process.env,
      SUPABASE_URL: local.url,
      SUPABASE_SECRET_KEY: local.secretKey,
      WORKER_ID: workerId,
      POLL_INTERVAL_MS: '200',
      ...env,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const output: string[] = [];
  child.stdout?.on('data', (d: Buffer) => output.push(d.toString()));
  child.stderr?.on('data', (d: Buffer) => output.push(d.toString()));
  return {
    child,
    output,
    async stop() {
      if (child.exitCode !== null || child.signalCode !== null) return;
      child.kill('SIGTERM');
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          child.kill('SIGKILL');
          resolve();
        }, 10_000);
        child.once('exit', () => {
          clearTimeout(timer);
          resolve();
        });
      });
    },
  };
}
