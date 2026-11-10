// T4.10 live check: starts real sandboxes (slim Supabase stack + egress proxy + agent container) on the Colima s2 Docker,
// asserts the security properties from INSIDE the agent container, measures memory, then tears down and verifies nothing
// is left. Manual only (needs Docker and several GB of images); never part of CI.
// Prerequisites: images from docker/sandbox (see docs/runbooks/sandbox.md). Stop the local Supabase stack first (3 GiB VM).
// Usage: pnpm --filter @aziz-hq/worker exec tsx scripts/sandbox-check.ts [--slots=1,2]
import { execFile } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { applySlotConfig, Sandbox, type Exec } from '../src/sandbox/sandbox.js';
import { planSlot } from '../src/sandbox/plan.js';

const repo = resolve(import.meta.dirname, '../../..');
const work = join(repo, '.sandbox-work');
const dockerHost = process.env.DOCKER_HOST ?? `unix://${homedir()}/.colima/s2/docker.sock`;
const slots = (process.argv.find((a) => a.startsWith('--slots='))?.slice(8) ?? '1')
  .split(',')
  .map(Number);

const exec: Exec = (cmd, args) =>
  new Promise((done) => {
    execFile(
      cmd,
      args,
      { env: { ...process.env, DOCKER_HOST: dockerHost }, maxBuffer: 64 * 1024 * 1024 },
      (err, stdout, stderr) =>
        done({ code: err ? (typeof err.code === 'number' ? err.code : 1) : 0, stdout, stderr }),
    );
  });

let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
};

async function sh(cmd: string, args: string[]) {
  const r = await exec(cmd, args);
  if (r.code !== 0) throw new Error(`${cmd} ${args.join(' ')}: ${r.stderr.trim()}`);
  return r.stdout.trim();
}

const mib = (s: string) => {
  const m = /^([\d.]+)(KiB|MiB|GiB)/.exec(s.trim());
  return m ? Number(m[1]) * { KiB: 1 / 1024, MiB: 1, GiB: 1024 }[m[2] as 'KiB' | 'MiB' | 'GiB'] : 0;
};

async function memory(slot: number): Promise<number> {
  const out = await sh('docker', ['stats', '--no-stream', '--format', '{{.Name}} {{.MemUsage}}']);
  return out
    .split('\n')
    .filter((l) => l.includes(`sbx${slot}`))
    .reduce((sum, l) => sum + mib(l.split(' ')[1] ?? ''), 0);
}

const remote = join(work, 'remote.git');
rmSync(work, { recursive: true, force: true });
mkdirSync(work, { recursive: true });
await sh('git', ['init', '-q', '--bare', remote]);

const sandboxes: { slot: number; sandbox: Sandbox }[] = [];
for (const slot of slots) {
  const plan = planSlot(slot);
  const worktree = join(work, `slot${slot}`);
  mkdirSync(worktree, { recursive: true });
  await sh('git', ['init', '-q', '-b', 'main', worktree]);
  await sh('supabase', ['init', '--force', '--workdir', worktree]);
  applySlotConfig(worktree, plan);
  await sh('chmod', ['-R', 'a+rwX', worktree, remote]); // the agent runs as uid 1000, the files belong to the host user
  sandboxes.push({
    slot,
    sandbox: new Sandbox(exec, {
      slot,
      worktree,
      extraMounts: [remote],
      agentImage: 'aziz-hq-sandbox-agent:local',
      proxyImage: 'aziz-hq-sandbox-proxy:local',
      agentLimits: { memory: '1g', cpus: 1, pids: 256 },
      stackLimits: { memory: '768m', cpus: 1 },
      exclude: 'studio,imgproxy,edge-runtime,logflare,vector,mailpit,supavisor',
    }),
  });
}

try {
  const t0 = Date.now();
  await Promise.all(sandboxes.map(({ sandbox }) => sandbox.start()));
  console.log(
    `started ${sandboxes.length} sandbox(es) in ${Math.round((Date.now() - t0) / 1000)} s`,
  );

  for (const { slot, sandbox } of sandboxes) {
    const tag = `slot${slot}`;
    const run = (cmd: string) => sandbox.run(['sh', '-c', cmd]);

    const db = await run(
      'PGPASSWORD=postgres psql -h "$SANDBOX_DB_HOST" -p 5432 -U postgres -d postgres -tAc "select 1"',
    );
    check(
      `${tag} reaches its own database over the internal network`,
      db.stdout.trim() === '1',
      db.stderr.trim(),
    );
    const api = await run(
      'curl -s -m 10 -o /dev/null -w "%{http_code}" "$SANDBOX_API_URL/rest/v1/"',
    );
    check(
      `${tag} reaches its API gateway`,
      /^[1-5]\d\d$/.test(api.stdout.trim()),
      `HTTP ${api.stdout.trim()}`,
    );
    const direct = await run('curl --noproxy "*" -s -m 6 -o /dev/null https://example.com');
    check(
      `${tag} has no direct route to the internet`,
      direct.code !== 0,
      `curl exit ${direct.code}`,
    );
    const byIp = await run('curl --noproxy "*" -s -m 6 -o /dev/null https://1.1.1.1');
    check(
      `${tag} has no route to a raw IP address either (not only no DNS)`,
      byIp.code !== 0,
      `curl exit ${byIp.code}`,
    );
    for (const other of slots.filter((o) => o !== slot)) {
      const cross = await run(
        `PGPASSWORD=postgres psql -h supabase_db_sbx${other} -p 5432 -U postgres -d postgres -tAc "select 1"`,
      );
      check(
        `${tag} cannot reach the database of slot${other}`,
        cross.code !== 0 && cross.stdout.trim() !== '1',
      );
    }
    const gh = await run('curl -s -m 25 -o /dev/null -w "%{http_code}" https://github.com');
    check(
      `${tag} reaches github.com through the proxy`,
      /^(200|301|302)$/.test(gh.stdout.trim()),
      `HTTP ${gh.stdout.trim()}`,
    );
    const other = await run('curl -s -m 25 -o /dev/null https://example.com');
    check(
      `${tag} is refused example.com by the proxy`,
      other.code !== 0,
      `curl exit ${other.code}`,
    );
    check(`${tag} has no Docker socket`, (await run('test ! -e /var/run/docker.sock')).code === 0);
    check(
      `${tag} root filesystem is read-only`,
      (await run('! touch /probe 2>/dev/null')).code === 0,
    );
    check(`${tag} runs as uid 1000`, (await run('id -u')).stdout.trim() === '1000');
    const env = await run('env | grep -ciE "secret|token|password|api_key" || true');
    check(
      `${tag} sees no secret-looking environment variable`,
      env.stdout.trim() === '0',
      env.stdout.trim(),
    );
    const mem = await run('cat /sys/fs/cgroup/memory.max');
    check(
      `${tag} memory limit is enforced`,
      mem.stdout.trim() === String(1024 ** 3),
      mem.stdout.trim(),
    );
    const push = await run(
      `echo hi > f.txt && git add -A && git commit -qm t && git remote add origin ${remote} && git push -q origin HEAD:refs/heads/${tag} && echo PUSH_OK`,
    );
    check(
      `${tag} can commit and push to its remote`,
      push.stdout.includes('PUSH_OK'),
      push.stderr.trim().slice(0, 200),
    );
  }

  const peak = await Promise.all(sandboxes.map(({ slot }) => memory(slot)));
  console.log(
    `\nmemory (stack + agent + proxy): ${peak.map((m, i) => `slot${slots[i]} ${Math.round(m)} MiB`).join(', ')}`,
  );
  console.log(
    `VM: ${(await sh('colima', ['ssh', '-p', 's2', '--', 'free', '-m'])).split('\n')[1]}`,
  );
} finally {
  const t1 = Date.now();
  for (const { sandbox } of sandboxes) {
    const { errors } = await sandbox.stop();
    for (const e of errors) console.log(`teardown warning: ${e}`);
  }
  console.log(`torn down in ${Math.round((Date.now() - t1) / 1000)} s`);
  const left = {
    containers: (await sh('docker', ['ps', '-a', '--format', '{{.Names}}']))
      .split('\n')
      .filter((n) => /sbx\d/.test(n)),
    networks: (await sh('docker', ['network', 'ls', '--format', '{{.Name}}']))
      .split('\n')
      .filter((n) => /sbx\d/.test(n)),
    volumes: (await sh('docker', ['volume', 'ls', '--format', '{{.Name}}']))
      .split('\n')
      .filter((n) => /sbx\d/.test(n)),
  };
  check('teardown left no containers', left.containers.length === 0, left.containers.join(','));
  check('teardown left no networks', left.networks.length === 0, left.networks.join(','));
  check('teardown left no volumes', left.volumes.length === 0, left.volumes.join(','));
  rmSync(work, { recursive: true, force: true });
}
console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
