// Creates the scripted fake run (parallel tasks, a failing-then-retried task, a gate; --crash adds a hanging task).
// Uses SUPABASE_URL + SUPABASE_SECRET_KEY, or the local stack when they are not set.
// Usage: pnpm fake-run [--crash]
import { execFileSync } from 'node:child_process';
import { createEngine, fakeRunSpec, type Database } from '@aziz-hq/core';
import { createClient } from '@supabase/supabase-js';

let url = process.env.SUPABASE_URL;
let key = process.env.SUPABASE_SECRET_KEY;
if (!url || !key) {
  const out = execFileSync('supabase', ['status', '-o', 'json'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  const local = JSON.parse(out.slice(out.indexOf('{'))) as Record<string, string>;
  url = local.API_URL;
  key = local.SECRET_KEY;
  console.log('Using the local Supabase stack');
}

const client = createClient<Database>(url!, key!, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const { runId, tasks } = await createEngine(client).createRun({
  moduleId: 'factory',
  title: `fake run ${new Date().toISOString().slice(11, 19)}`,
  tasks: fakeRunSpec({ crash: process.argv.includes('--crash') }),
});
console.log(
  `Run ${runId} with ${Object.keys(tasks).length} tasks. Approve the gate in the dashboard (M3) or with decide_gate.`,
);
