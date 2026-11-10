import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  agentRunArgs,
  limitArgs,
  offsetSupabaseConfig,
  planSlot,
  proxyRunArgs,
  teardownSteps,
  type AgentLimits,
  type SlotPlan,
} from './plan.js';

export interface ExecResult {
  code: number;
  stdout: string;
  stderr: string;
}

/** Runs a host command (`docker` or `supabase`). Injected so the lifecycle is testable without Docker. */
export type Exec = (cmd: string, args: string[]) => Promise<ExecResult>;

export interface SandboxConfig {
  slot: number;
  worktree: string;
  extraMounts?: string[];
  agentImage: string;
  proxyImage: string;
  agentLimits: AgentLimits;
  /** Memory and cpu cap applied to every container of the Supabase stack with `docker update`. */
  stackLimits: { memory: string; cpus: number };
  /** Services left out of `supabase start` (the slim stack). */
  exclude: string;
}

/** Gives the worktree's `supabase/config.toml` the slot's project id and ports. Call once on the pristine file. */
export function applySlotConfig(worktree: string, plan: SlotPlan): void {
  const path = join(worktree, 'supabase', 'config.toml');
  writeFileSync(path, offsetSupabaseConfig(readFileSync(path, 'utf8'), plan));
}

const NOT_FOUND = /no such|not found|is not running|does not exist/i;

/**
 * One sandbox (topology A-prime, spike S2): a slim Supabase stack started by the worker, an egress allowlist proxy, and
 * an agent container with no Docker socket on an internal-only network. `start` leaves nothing behind when it fails.
 */
export class Sandbox {
  readonly plan: SlotPlan;

  constructor(
    private readonly exec: Exec,
    private readonly config: SandboxConfig,
  ) {
    this.plan = planSlot(config.slot);
  }

  private async must(cmd: string, args: string[]): Promise<ExecResult> {
    const r = await this.exec(cmd, args);
    if (r.code !== 0) {
      throw new Error(
        `${cmd} ${args.join(' ')} failed (exit ${r.code}): ${r.stderr.trim().slice(0, 500)}`,
      );
    }
    return r;
  }

  async start(): Promise<void> {
    const { plan, config } = this;
    try {
      await this.must('docker', ['network', 'create', '--internal', plan.internalNetwork]);
      await this.must('docker', proxyRunArgs(plan, { image: config.proxyImage }));
      await this.must('docker', ['network', 'connect', plan.internalNetwork, plan.proxyContainer]);

      await this.must('supabase', ['start', '--workdir', config.worktree, '-x', config.exclude]);
      const ps = await this.must('docker', [
        'ps',
        '--filter',
        `label=com.supabase.cli.project=${plan.projectId}`,
        '--format',
        '{{.Names}}',
      ]);
      const stack = ps.stdout
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean);
      for (const needed of [plan.dbContainer, plan.kongContainer]) {
        if (!stack.includes(needed))
          throw new Error(
            `the stack has no ${needed} container (found: ${stack.join(', ') || 'none'})`,
          );
      }
      await this.must('docker', limitArgs(stack, config.stackLimits));
      // only the database and the API gateway are reachable from the agent's network
      for (const name of [plan.dbContainer, plan.kongContainer]) {
        await this.must('docker', ['network', 'connect', plan.internalNetwork, name]);
      }

      await this.must(
        'docker',
        agentRunArgs(plan, {
          image: config.agentImage,
          worktree: config.worktree,
          extraMounts: config.extraMounts,
          limits: config.agentLimits,
          proxyUrl: `http://${plan.proxyContainer}:8888`,
          command: ['sleep', 'infinity'],
        }),
      );
    } catch (e) {
      await this.stop();
      throw e;
    }
  }

  /** Runs a command in the agent container. A failing command is a result, not an exception. */
  run(command: string[]): Promise<ExecResult> {
    return this.exec('docker', [
      'exec',
      '-w',
      this.config.worktree,
      this.plan.agentContainer,
      ...command,
    ]);
  }

  /** Every teardown step runs even if another fails; "already gone" is not an error. */
  async stop(): Promise<{ errors: string[] }> {
    const errors: string[] = [];
    for (const [cmd, ...args] of teardownSteps(this.plan)) {
      const r = await this.exec(cmd!, args);
      if (r.code !== 0 && !NOT_FOUND.test(r.stderr)) {
        errors.push(`${cmd} ${args.join(' ')}: ${r.stderr.trim().slice(0, 300)}`);
      }
    }
    return { errors };
  }
}
