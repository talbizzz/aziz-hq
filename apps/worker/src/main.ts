import { readFileSync } from 'node:fs';
import { RunnerRegistry, FakeRunner, runnerConfigSchema } from '@aziz-hq/agents-sdk';
import { createEngine, type Database } from '@aziz-hq/core';
import { createClient } from '@supabase/supabase-js';
import { loadConfig } from './config.js';
import type { EventSink, Logger } from './engine.js';
import { runWorker } from './loop.js';

const log: Logger = {
  info: (msg, data) => console.log(JSON.stringify({ level: 'info', msg, ...data })),
  warn: (msg, data) => console.warn(JSON.stringify({ level: 'warn', msg, ...data })),
  error: (msg, data) => console.error(JSON.stringify({ level: 'error', msg, ...data })),
};

const config = loadConfig();
const runnerConfig = runnerConfigSchema.parse(
  JSON.parse(readFileSync(new URL('../runners.config.json', import.meta.url), 'utf8')),
);

// sb_secret_ keys are not JWTs: they go in the apikey header only, never as a Bearer token.
const client = createClient<Database>(config.supabaseUrl, config.supabaseSecretKey, {
  auth: { persistSession: false, autoRefreshToken: false },
  global: {
    fetch: (input, init) => {
      const headers = new Headers(init?.headers);
      if (config.supabaseSecretKey.startsWith('sb_secret_')) headers.delete('Authorization');
      return fetch(input, { ...init, headers });
    },
  },
});

const events: EventSink = async (task, runnerEvents) => {
  if (runnerEvents.length === 0) return;
  const { error } = await client.from('events').insert(
    runnerEvents.map((e) => ({
      run_id: task.run_id,
      task_id: task.id,
      entity_type: 'task',
      entity_id: task.id,
      kind: e.kind,
      actor_type: 'agent' as const,
      actor_id: task.role ?? task.type,
      data: e.data as never,
    })),
  );
  if (error) throw new Error(error.message);
};

const shutdown = new AbortController();
for (const sig of ['SIGTERM', 'SIGINT'] as const) process.on(sig, () => shutdown.abort());

log.info('worker starting', { workerId: config.workerId, concurrency: config.concurrency });
await runWorker(
  {
    engine: createEngine(client),
    runners: new RunnerRegistry().register('fake', new FakeRunner()),
    runnerConfig,
    events,
    config,
    log,
  },
  shutdown.signal,
);
log.info('worker stopped');
