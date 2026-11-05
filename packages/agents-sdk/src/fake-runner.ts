import { z } from 'zod';
import type { Runner, RunnerInput, RunnerResult } from './runner.js';

const outcomeSchema = z.object({
  status: z.enum(['done', 'failed', 'needs_human']),
  summary: z.string().optional(),
  /** Wait until the signal aborts instead of finishing (simulates a stuck task). */
  hang: z.boolean().optional(),
});

/** Scripts a FakeRunner per task through `task.payload.fake`; stateless, so a restarted worker behaves the same. */
export const fakePayloadSchema = z.object({
  outcomes: z.array(outcomeSchema).min(1).optional(),
  delayMs: z.number().int().nonnegative().optional(),
});

const abortReason = (signal: AbortSignal) =>
  signal.reason instanceof Error ? signal.reason : new Error('aborted');

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(abortReason(signal));
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortReason(signal));
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

const untilAborted = (signal: AbortSignal): Promise<never> =>
  new Promise((_, reject) => {
    if (signal.aborted) return reject(abortReason(signal));
    signal.addEventListener('abort', () => reject(abortReason(signal)), { once: true });
  });

export class FakeRunner implements Runner {
  readonly name = 'fake';

  async run(input: RunnerInput): Promise<RunnerResult> {
    if (input.signal.aborted) throw abortReason(input.signal);

    const parsed = fakePayloadSchema.safeParse(input.task.payload.fake ?? {});
    if (!parsed.success) throw new Error(`invalid payload.fake: ${parsed.error.message}`);
    const { outcomes = [{ status: 'done' as const }], delayMs = 0 } = parsed.data;
    const outcome = outcomes[Math.min(input.task.attempt - 1, outcomes.length - 1)]!;

    if (delayMs > 0) await sleep(delayMs, input.signal);
    if (outcome.hang) await untilAborted(input.signal);

    return {
      status: outcome.status,
      summary: outcome.summary ?? `fake ${outcome.status}`,
      costUsd: 0,
      events: [
        { kind: 'fake.started', data: { attempt: input.task.attempt, role: input.role } },
        { kind: 'fake.finished', data: { status: outcome.status } },
      ],
    };
  }
}
