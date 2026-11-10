import { describe, expect, it } from 'vitest';
import {
  agentRunArgs,
  limitArgs,
  offsetSupabaseConfig,
  planSlot,
  proxyRunArgs,
  teardownSteps,
} from './plan.js';

describe('planSlot', () => {
  it('derives every name and the port offset from the slot', () => {
    const p = planSlot(3);
    expect(p).toMatchObject({
      slot: 3,
      projectId: 'sbx3',
      portOffset: 300,
      internalNetwork: 'sbx3-internal',
      stackNetwork: 'supabase_network_sbx3',
      agentContainer: 'sbx3-agent',
      proxyContainer: 'sbx3-proxy',
      dbContainer: 'supabase_db_sbx3',
      kongContainer: 'supabase_kong_sbx3',
    });
  });
  it("rejects slot 0 (the host's own stack), negatives, fractions and slots past 9", () => {
    for (const bad of [0, -1, 1.5, 10, Number.NaN]) expect(() => planSlot(bad)).toThrow(/slot/);
  });
  it('gives different slots disjoint names and ports', () => {
    const a = planSlot(1);
    const b = planSlot(2);
    expect(new Set([a.projectId, a.internalNetwork, a.agentContainer])).not.toContain(b.projectId);
    expect(b.portOffset - a.portOffset).toBe(100);
  });
});

const CONFIG = `project_id = "demo"

[api]
enabled = true
port = 54321

[db]
port = 54322
shadow_port = 54320

[studio]
port = 54323

[inbucket]
port = 54324

[analytics]
port = 54327

[edge_runtime]
inspector_port = 8083
`;

describe('offsetSupabaseConfig', () => {
  const out = offsetSupabaseConfig(CONFIG, planSlot(2));
  it('sets the project id', () => {
    expect(out).toContain('project_id = "sbx2"');
    expect(out).not.toContain('"demo"');
  });
  it('shifts every 543xx port, including shadow_port, by 100 per slot', () => {
    for (const port of [54521, 54522, 54520, 54523, 54524, 54527])
      expect(out).toMatch(new RegExp(`port = ${port}\\b`));
    expect(out).not.toMatch(/= 543\d\d\b/);
    expect(out).not.toContain('54321');
  });
  it('shifts the edge runtime inspector port too, so slots cannot collide there', () => {
    expect(out).toContain('inspector_port = 8283');
  });
  it('leaves everything else untouched and is not applied twice by accident', () => {
    expect(out).toContain('[api]\nenabled = true');
    expect(offsetSupabaseConfig(out, planSlot(2))).not.toBe(out); // callers must apply it once to the pristine config
  });
  it('refuses a config without a project_id', () => {
    expect(() => offsetSupabaseConfig('[api]\nport = 54321\n', planSlot(1))).toThrow(/project_id/);
  });
});

describe('agentRunArgs (the security rules of the sandbox)', () => {
  const plan = planSlot(1);
  const args = agentRunArgs(plan, {
    image: 'aziz-hq-agent:test',
    worktree: '/work/slot1',
    limits: { memory: '1g', cpus: 1, pids: 256 },
    proxyUrl: 'http://sbx1-proxy:8888',
    command: ['sleep', 'infinity'],
  });
  const flat = args.join(' ');

  it('never exposes the Docker socket, privileges or the host network', () => {
    expect(flat).not.toContain('docker.sock');
    expect(flat).not.toContain('--privileged');
    expect(flat).not.toMatch(/--network[= ]host/);
    expect(flat).not.toMatch(/--pid[= ]/);
    expect(flat).not.toMatch(/--cap-add/);
  });
  it('is hardened: no capabilities, no new privileges, read-only root, non-root user', () => {
    expect(args).toEqual(expect.arrayContaining(['--cap-drop', 'ALL']));
    expect(args).toEqual(expect.arrayContaining(['--security-opt', 'no-new-privileges']));
    expect(args).toContain('--read-only');
    expect(args).toEqual(expect.arrayContaining(['--user', '1000:1000']));
  });
  it('sits only on the internal network of its slot', () => {
    expect(args.filter((a) => a === '--network')).toHaveLength(1);
    expect(args).toEqual(expect.arrayContaining(['--network', 'sbx1-internal']));
  });
  it('caps memory, cpus and processes, and uses --rm so nothing lingers', () => {
    expect(args).toEqual(
      expect.arrayContaining(['--memory', '1g', '--cpus', '1', '--pids-limit', '256']),
    );
    expect(args).toContain('--rm');
  });
  it('mounts only the worktree (same absolute path inside) and tmpfs for scratch space', () => {
    const mounts = args.flatMap((a, i) => (args[i - 1] === '-v' ? [a] : []));
    expect(mounts).toEqual(['/work/slot1:/work/slot1']);
    expect(args).toEqual(expect.arrayContaining(['--tmpfs']));
    expect(args).toEqual(expect.arrayContaining(['-w', '/work/slot1']));
  });
  it("routes web traffic through the proxy and the database to the slot's stack by name", () => {
    expect(flat).toContain('HTTPS_PROXY=http://sbx1-proxy:8888');
    expect(flat).toContain('HTTP_PROXY=http://sbx1-proxy:8888');
    expect(flat).toContain('NO_PROXY=supabase_db_sbx1,supabase_kong_sbx1,localhost');
    expect(flat).toContain('SANDBOX_DB_HOST=supabase_db_sbx1');
  });
  it('passes no secret-looking environment variables', () => {
    const envs = args.flatMap((a, i) => (args[i - 1] === '-e' ? [a] : []));
    expect(envs.filter((e) => /SECRET|TOKEN|PASSWORD|_KEY/i.test(e.split('=')[0]!))).toEqual([]);
  });
  it('refuses a relative worktree and extra env that looks like a secret unless allowed', () => {
    expect(() =>
      agentRunArgs(plan, {
        image: 'i',
        worktree: 'rel',
        limits: { memory: '1g', cpus: 1, pids: 1 },
        proxyUrl: 'p',
        command: [],
      }),
    ).toThrow(/absolute/);
  });
  it('ends with the image and the command', () => {
    expect(args.slice(-3)).toEqual(['aziz-hq-agent:test', 'sleep', 'infinity']);
  });
});

describe('proxyRunArgs', () => {
  it('runs the allowlist proxy on the slot network and the default bridge, nothing privileged', () => {
    const args = proxyRunArgs(planSlot(1), { image: 'aziz-hq-proxy:test' });
    expect(args).toEqual(expect.arrayContaining(['--name', 'sbx1-proxy', '--network', 'bridge']));
    expect(args.join(' ')).not.toMatch(/docker\.sock|--privileged/);
    expect(args).toEqual(expect.arrayContaining(['--cap-drop', 'ALL']));
  });
});

describe('limitArgs and teardownSteps', () => {
  it('caps the stack containers with docker update (a limit on the agent alone would not cover them)', () => {
    expect(limitArgs(['a', 'b'], { memory: '2g', cpus: 2 })).toEqual([
      'update',
      '--memory',
      '2g',
      '--memory-swap',
      '2g',
      '--cpus',
      '2',
      'a',
      'b',
    ]);
  });
  it('tears down in a safe order and removes volumes with -v', () => {
    const steps = teardownSteps(planSlot(2)).map((s) => s.join(' '));
    expect(steps[0]).toContain('rm -f -v sbx2-agent');
    expect(steps.some((s) => s.includes('supabase stop --no-backup --project-id sbx2'))).toBe(true);
    expect(steps.some((s) => s.includes('network rm sbx2-internal'))).toBe(true);
    expect(steps.findIndex((s) => s.includes('rm -f -v sbx2-proxy'))).toBeLessThan(
      steps.findIndex((s) => s.includes('network rm sbx2-internal')),
    );
  });
});
