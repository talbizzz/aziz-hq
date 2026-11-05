import { z } from 'zod';

/** What a runner receives for one attempt of one task. */
export interface RunnerInput {
  role: string;
  task: {
    id: string;
    runId: string;
    title: string;
    payload: Record<string, unknown>;
    attempt: number;
  };
  context: Record<string, unknown>;
  workdir: string;
  budget: { timeoutMs: number; maxCostUsd?: number };
  /** Aborted on timeout, lease loss or shutdown; runners must stop promptly. */
  signal: AbortSignal;
}

export const runnerResultSchema = z.object({
  status: z.enum(['done', 'failed', 'needs_human']),
  summary: z.string(),
  costUsd: z.number().nonnegative(),
  events: z.array(
    z.object({
      kind: z.string().min(1),
      data: z.record(z.string(), z.unknown()).default({}),
    }),
  ),
});

export type RunnerResult = z.infer<typeof runnerResultSchema>;

export interface Runner {
  readonly name: string;
  run(input: RunnerInput): Promise<RunnerResult>;
}
