import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { planSlot } from './plan.js';
import { applySlotConfig, Sandbox, type Exec } from './sandbox.js';

interface Call {
  cmd: string;
  args: string[];
}

/** Records every command; `fail` makes a command fail; `stackIds` is what `docker ps` returns for the stack. */
function fakeExec(opts: { fail?: (c: Call) => boolean; stackIds?: string[] } = {}) {
  const calls: Call[] = [];
  const exec: Exec = async (cmd, args) => {
    const call = { cmd, args };
    calls.push(call);
    if (opts.fail?.(call)) return { code: 1, stdout: '', stderr: 'boom' };
    if (cmd === 'docker' && args[0] === 'ps')
      return { code: 0, stdout: (opts.stackIds ?? []).join('\n') + '\n', stderr: '' };
    return { code: 0, stdout: '', stderr: '' };
  };
  const line = (c: Call) => `${c.cmd} ${c.args.join(' ')}`;
  return {
    calls,
    exec,
    lines: () => calls.map(line),
    has: (s: string) => calls.some((c) => line(c).includes(s)),
  };
}

const config = {
  slot: 2,
  worktree: '/work/slot2',
  agentImage: 'agent:t',
  proxyImage: 'proxy:t',
  agentLimits: { memory: '1g', cpus: 1, pids: 256 },
  stackLimits: { memory: '768m', cpus: 1 },
  exclude: 'studio,imgproxy,edge-runtime,logflare,vector,mailpit,supavisor',
};
const STACK = ['supabase_db_sbx2', 'supabase_kong_sbx2', 'supabase_auth_sbx2'];

describe('Sandbox.start', () => {
  it('builds the isolated network, the proxy, the stack, the limits, then the agent, in that order', async () => {
    const f = fakeExec({ stackIds: STACK });
    await new Sandbox(f.exec, config).start();
    const order = f.lines();
    const at = (s: string) => order.findIndex((l) => l.includes(s));
    expect(at('network create --internal sbx2-internal')).toBeGreaterThanOrEqual(0);
    expect(at('network create --internal')).toBeLessThan(at('--name sbx2-proxy'));
    expect(at('network connect sbx2-internal sbx2-proxy')).toBeGreaterThan(at('--name sbx2-proxy'));
    expect(at('supabase start')).toBeGreaterThan(at('network connect sbx2-internal sbx2-proxy'));
    expect(at('update --memory 768m')).toBeGreaterThan(at('supabase start'));
    expect(at('network connect sbx2-internal supabase_db_sbx2')).toBeGreaterThan(
      at('update --memory'),
    );
    expect(at('--name sbx2-agent')).toBeGreaterThan(
      at('network connect sbx2-internal supabase_kong_sbx2'),
    );
  });

  it('starts the slim stack from the worktree and excludes the heavy services', async () => {
    const f = fakeExec({ stackIds: STACK });
    await new Sandbox(f.exec, config).start();
    const start = f.calls.find((c) => c.cmd === 'supabase' && c.args[0] === 'start')!;
    expect(start.args).toEqual(['start', '--workdir', '/work/slot2', '-x', config.exclude]);
  });

  it('caps every stack container with docker update', async () => {
    const f = fakeExec({ stackIds: STACK });
    await new Sandbox(f.exec, config).start();
    const upd = f.calls.find((c) => c.cmd === 'docker' && c.args[0] === 'update')!;
    expect(upd.args).toEqual(expect.arrayContaining(STACK));
    expect(upd.args).toEqual(expect.arrayContaining(['--memory', '768m', '--cpus', '1']));
  });

  it('connects only the database and the API gateway of the stack to the internal network', async () => {
    const f = fakeExec({ stackIds: STACK });
    await new Sandbox(f.exec, config).start();
    const connected = f.calls
      .filter((c) => c.cmd === 'docker' && c.args[0] === 'network' && c.args[1] === 'connect')
      .map((c) => c.args[3]);
    expect(connected.sort()).toEqual(
      ['sbx2-proxy', 'supabase_db_sbx2', 'supabase_kong_sbx2'].sort(),
    );
  });

  it('tears everything down when any step of the start fails, and reports the failure', async () => {
    const f = fakeExec({
      stackIds: STACK,
      fail: (c) => c.cmd === 'supabase' && c.args[0] === 'start',
    });
    await expect(new Sandbox(f.exec, config).start()).rejects.toThrow(/supabase start/);
    expect(f.has('rm -f -v sbx2-agent')).toBe(true);
    expect(f.has('network rm sbx2-internal')).toBe(true);
    expect(f.has('supabase stop --no-backup --project-id sbx2')).toBe(true);
  });

  it('fails clearly when the stack has no database container', async () => {
    const f = fakeExec({ stackIds: ['supabase_auth_sbx2'] });
    await expect(new Sandbox(f.exec, config).start()).rejects.toThrow(/supabase_db_sbx2/);
    expect(f.has('network rm sbx2-internal')).toBe(true);
  });
});

describe('Sandbox.run and stop', () => {
  it('runs a command inside the agent container as the agent user, in the worktree', async () => {
    const f = fakeExec();
    await new Sandbox(f.exec, config).run(['git', 'push', 'origin', 'HEAD']);
    expect(f.calls[0]).toEqual({
      cmd: 'docker',
      args: ['exec', '-w', '/work/slot2', 'sbx2-agent', 'git', 'push', 'origin', 'HEAD'],
    });
  });

  it('returns exit code and output without throwing on a failing command (the agent may fail)', async () => {
    const f = fakeExec({ fail: (c) => c.args.includes('curl') });
    await expect(
      new Sandbox(f.exec, config).run(['curl', 'https://example.com']),
    ).resolves.toMatchObject({
      code: 1,
      stderr: 'boom',
    });
  });

  it('stop runs every teardown step even when some fail, then reports what failed', async () => {
    const f = fakeExec({ fail: (c) => c.args.includes('sbx2-proxy') && c.args.includes('rm') });
    const result = await new Sandbox(f.exec, config).stop();
    expect(f.lines()).toHaveLength(5);
    expect(result.errors).toHaveLength(1);
  });

  it('stop ignores "not found" so it can run twice', async () => {
    const f = fakeExec();
    const s = new Sandbox(f.exec, config);
    await s.stop();
    await expect(s.stop()).resolves.toMatchObject({ errors: [] });
  });
});

describe('applySlotConfig', () => {
  it('rewrites supabase/config.toml in the worktree for the slot', () => {
    const dir = mkdtempSync(join(tmpdir(), 'slot-'));
    mkdirSync(join(dir, 'supabase'));
    writeFileSync(join(dir, 'supabase/config.toml'), 'project_id = "x"\n[api]\nport = 54321\n');
    applySlotConfig(dir, planSlot(2));
    const out = readFileSync(join(dir, 'supabase/config.toml'), 'utf8');
    expect(out).toContain('project_id = "sbx2"');
    expect(out).toContain('port = 54521');
  });
});
