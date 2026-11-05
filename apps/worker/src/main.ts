import { readFileSync } from 'node:fs';
import {
  ClaudeCodeSubscriptionRunner,
  FakeRunner,
  RunnerRegistry,
  runnerConfigSchema,
} from '@aziz-hq/agents-sdk';
import { createEngine, type Database } from '@aziz-hq/core';
import { createClient } from '@supabase/supabase-js';
import { loadConfig } from './config.js';
import type { EventSink, Logger } from './engine.js';
import { runWorker } from './loop.js';
import { createPolicyProvider } from './policy-source.js';
import { createPolicyDb, createRunRecorder } from './supabase-adapters.js';

const log: Logger = {
  info: (msg, data) => console.log(JSON.stringify({ level: 'info', msg, ...data })),
  warn: (msg, data) => console.warn(JSON.stringify({ level: 'warn', msg, ...data })),
  error: (msg, data) => console.error(JSON.stringify({ level: 'error', msg, ...data })),
};

const config = loadConfig();
const runnerConfig = runnerConfigSchema.parse(
  JSON.parse(readFileSync(new URL('../runners.config.json', import.meta.url), 'utf8')),
);

// supabase-js sends sb_secret_ keys as the apikey header (verified by the integration tests).
const client = createClient<Database>(config.supabaseUrl, config.supabaseSecretKey, {
  auth: { persistSession: false, autoRefreshToken: false },
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
const engine = createEngine(client);
await runWorker(
  {
    engine,
    runners: new RunnerRegistry().register('fake', new FakeRunner()).register(
      'claude-code-subscription',
      new ClaudeCodeSubscriptionRunner({
        claudeBin: process.env.CLAUDE_BIN,
        configDir: process.env.CLAUDE_CONFIG_DIR,
      }),
    ),
    runnerConfig,
    events,
    recorder: createRunRecorder({ db: client, engine }),
    // the usage policy (ADR-15) gates claiming; set USAGE_POLICY=off only for experiments
    policy:
      process.env.USAGE_POLICY === 'off' ? undefined : createPolicyProvider(createPolicyDb(client)),
    config,
    log,
  },
  shutdown.signal,
);
log.info('worker stopped');
