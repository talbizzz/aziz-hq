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

const windowSchema = z.object({ pct: z.number(), resetsAt: z.date(), status: z.string() });

export const runnerResultSchema = z.object({
  /** `limit`: the plan limit was hit; a pause, not a failure (ADR-15). */
  status: z.enum(['done', 'failed', 'needs_human', 'limit']),
  summary: z.string(),
  costUsd: z.number().nonnegative(),
  /** For `limit`: when the blocked window resets. */
  resetsAt: z.date().optional(),
  /** For `failed`: a stable machine-readable kind (`auth`, `claude_failed`, `protected_tests`, `out_of_scope`, `config`, ...). */
  errorKind: z.string().optional(),
  usage: z
    .object({
      inputTokens: z.number(),
      outputTokens: z.number(),
      cacheReadTokens: z.number(),
      cacheWriteTokens: z.number(),
      costUsd: z.number(),
      model: z.string(),
    })
    .optional(),
  rateLimit: z.object({ fiveHour: windowSchema, sevenDay: windowSchema }).optional(),
  /** The redacted raw output of the run (stored as a transcript by the worker). */
  transcript: z.string().optional(),
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
