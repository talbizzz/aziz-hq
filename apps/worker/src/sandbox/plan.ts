// Pure planning for the per-task Docker sandbox (T4.10, topology A-prime from spike S2). No process is started here:
// names, ports and the exact `docker` argument lists are computed and tested, then run by `sandbox.ts`.
//
// Shape: the WORKER starts a slim Supabase stack for the slot (it holds the Docker socket). The AGENT container has no
// socket and sits alone on an internal-only network; only the stack's database and API containers and the egress proxy are
// connected to that network. So the agent cannot reach the internet except through the allowlist proxy.

export interface SlotPlan {
  slot: number;
  projectId: string;
  portOffset: number;
  internalNetwork: string;
  stackNetwork: string;
  agentContainer: string;
  proxyContainer: string;
  dbContainer: string;
  kongContainer: string;
}

/** Slot 0 is the host's own stack; slots 1-9 are sandboxes (ports base + 100 * slot stay below 65535). */
export function planSlot(slot: number): SlotPlan {
  if (!Number.isInteger(slot) || slot < 1 || slot > 9) {
    throw new Error(`sandbox slot must be an integer from 1 to 9, got ${slot}`);
  }
  const projectId = `sbx${slot}`;
  return {
    slot,
    projectId,
    portOffset: slot * 100,
    internalNetwork: `${projectId}-internal`,
    stackNetwork: `supabase_network_${projectId}`,
    agentContainer: `${projectId}-agent`,
    proxyContainer: `${projectId}-proxy`,
    dbContainer: `supabase_db_${projectId}`,
    kongContainer: `supabase_kong_${projectId}`,
  };
}

/**
 * Gives a pristine `supabase/config.toml` the slot's project id and shifts every 543xx port (including `shadow_port`)
 * and the edge runtime `inspector_port` by 100 per slot. Apply it once, to the original file.
 */
export function offsetSupabaseConfig(toml: string, plan: SlotPlan): string {
  if (!/^project_id\s*=/m.test(toml)) throw new Error('supabase config has no project_id');
  return toml
    .replace(/^project_id\s*=.*$/m, `project_id = "${plan.projectId}"`)
    .replace(
      /^(\s*(?:\w+_)?port\s*=\s*)(543\d\d)\b/gm,
      (_m, head: string, port: string) => `${head}${Number(port) + plan.portOffset}`,
    )
    .replace(
      /^(\s*inspector_port\s*=\s*)(\d+)\b/gm,
      (_m, head: string, port: string) => `${head}${Number(port) + plan.portOffset}`,
    );
}

export interface AgentLimits {
  memory: string;
  cpus: number;
  pids: number;
}

export interface AgentOptions {
  image: string;
  /** Mounted at the identical absolute path inside the container (spike S2). */
  worktree: string;
  /** Further read-write mounts (e.g. a local git remote), same absolute path inside. The Docker socket is refused. */
  extraMounts?: string[];
  limits: AgentLimits;
  proxyUrl: string;
  command: string[];
  /** Extra environment; secret-looking names are refused. */
  env?: Record<string, string>;
}

const SECRETISH = /SECRET|TOKEN|PASSWORD|_KEY/i;

export function agentRunArgs(plan: SlotPlan, o: AgentOptions): string[] {
  if (!o.worktree.startsWith('/')) throw new Error('worktree must be an absolute path');
  for (const m of o.extraMounts ?? []) {
    if (!m.startsWith('/')) throw new Error(`mount must be an absolute path: ${m}`);
    if (/docker\.sock/.test(m))
      throw new Error('refusing to mount the Docker socket into the sandbox');
  }
  const env: Record<string, string> = {
    HTTP_PROXY: o.proxyUrl,
    HTTPS_PROXY: o.proxyUrl,
    http_proxy: o.proxyUrl,
    https_proxy: o.proxyUrl,
    NO_PROXY: `${plan.dbContainer},${plan.kongContainer},localhost`,
    SANDBOX_DB_HOST: plan.dbContainer,
    SANDBOX_API_URL: `http://${plan.kongContainer}:8000`,
    HOME: '/home/agent',
    ...o.env,
  };
  for (const name of Object.keys(o.env ?? {})) {
    if (SECRETISH.test(name)) throw new Error(`refusing to pass ${name} into the sandbox`);
  }
  return [
    'run',
    '-d',
    '--rm',
    '--name',
    plan.agentContainer,
    '--network',
    plan.internalNetwork,
    '--user',
    '1000:1000',
    '--read-only',
    '--cap-drop',
    'ALL',
    '--security-opt',
    'no-new-privileges',
    '--memory',
    o.limits.memory,
    '--cpus',
    String(o.limits.cpus),
    '--pids-limit',
    String(o.limits.pids),
    '--tmpfs',
    '/tmp:rw,size=256m,uid=1000,gid=1000',
    '--tmpfs',
    '/home/agent:rw,size=512m,uid=1000,gid=1000',
    '-v',
    `${o.worktree}:${o.worktree}`,
    ...(o.extraMounts ?? []).flatMap((m) => ['-v', `${m}:${m}`]),
    '-w',
    o.worktree,
    ...Object.entries(env).flatMap(([k, v]) => ['-e', `${k}=${v}`]),
    o.image,
    ...o.command,
  ];
}

export function proxyRunArgs(plan: SlotPlan, o: { image: string }): string[] {
  return [
    'run',
    '-d',
    '--rm',
    '--name',
    plan.proxyContainer,
    // starts on the default bridge (internet access); `sandbox.ts` also connects it to the slot's internal network
    '--network',
    'bridge',
    '--cap-drop',
    'ALL',
    '--security-opt',
    'no-new-privileges',
    '--read-only',
    '--tmpfs',
    '/tmp:rw,size=16m',
    '--memory',
    '64m',
    o.image,
  ];
}

export function limitArgs(containers: string[], l: { memory: string; cpus: number }): string[] {
  return [
    'update',
    '--memory',
    l.memory,
    '--memory-swap',
    l.memory,
    '--cpus',
    String(l.cpus),
    ...containers,
  ];
}

/** Every command (as argv for `docker`, or `supabase` where marked) needed to leave nothing behind. */
export function teardownSteps(plan: SlotPlan): string[][] {
  return [
    ['docker', 'rm', '-f', '-v', plan.agentContainer],
    ['docker', 'rm', '-f', '-v', plan.proxyContainer],
    ['supabase', 'stop', '--no-backup', '--project-id', plan.projectId],
    ['docker', 'network', 'rm', plan.internalNetwork],
    ['docker', 'network', 'rm', plan.stackNetwork],
  ];
}
