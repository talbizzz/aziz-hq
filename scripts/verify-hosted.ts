// Verifies a Supabase project from the outside with the publishable key only (no service key).
// Works against hosted or local. Usage: VITE_SUPABASE_URL=... VITE_SUPABASE_PUBLISHABLE_KEY=... pnpm tsx scripts/verify-hosted.ts
const url = process.env.VITE_SUPABASE_URL;
const key = process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
if (!url || !key)
  throw new Error('VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY are required');

const tables = [
  'app_owner',
  'modules',
  'runs',
  'tasks',
  'gates',
  'events',
  'usage',
  'worker_heartbeats',
  'settings',
];
const headers = { apikey: key, 'Content-Type': 'application/json' };
const failures: string[] = [];
const check = (ok: boolean, label: string) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok) failures.push(label);
};

const health = await fetch(`${url}/rest/v1/rpc/health`, { method: 'POST', headers, body: '{}' });
check(health.status === 200 && (await health.text()) === '"ok"', "rpc('health') returns ok");

for (const t of tables) {
  const res = await fetch(`${url}/rest/v1/${t}?select=*&limit=1`, { headers });
  const body = (await res.json().catch(() => null)) as unknown;
  const denied = res.status >= 400;
  const empty = res.status === 200 && Array.isArray(body) && body.length === 0;
  check(denied || empty, `anon cannot read ${t} (status ${res.status})`);
}

const owner = await fetch(`${url}/rest/v1/rpc/is_owner`, { method: 'POST', headers, body: '{}' });
check(owner.status >= 400, `anon cannot call is_owner() (status ${owner.status})`);

const signup = await fetch(`${url}/auth/v1/signup`, {
  method: 'POST',
  headers,
  body: JSON.stringify({
    email: `verify-${Date.now()}@example.invalid`,
    password: 'Not-A-Real-Passw0rd!',
  }),
});
check(signup.status >= 400, `sign-up is disabled (status ${signup.status})`);

if (failures.length > 0) {
  console.error(`\n${failures.length} check(s) failed`);
  process.exit(1);
}
console.log('\nAll checks passed');

export {};
