import { z } from 'zod';
import type { Runner } from './runner.js';

/** `apps/worker/runners.config.json`: which runner handles which role. */
export const runnerConfigSchema = z.object({
  default: z.string().min(1),
  roles: z.record(z.string(), z.string()).default({}),
});
export type RunnerConfig = z.infer<typeof runnerConfigSchema>;

export class RunnerRegistry {
  private readonly runners = new Map<string, Runner>();

  register(name: string, runner: Runner): this {
    this.runners.set(name, runner);
    return this;
  }

  forRole(role: string, config: RunnerConfig): Runner {
    const name = config.roles[role] ?? config.default;
    const runner = this.runners.get(name);
    if (!runner) throw new Error(`unknown runner: ${name}`);
    return runner;
  }
}
