export interface Failure {
  /** The failing test (or check) name. */
  test: string;
  /** The error it failed with. */
  error: string;
}

export interface Evidence extends Failure {
  attempt: number;
}

export type GuardResult =
  | { tripped: false }
  | {
      tripped: true;
      reason: 'max_attempts' | 'same_error_twice' | 'timeout';
      evidence: Evidence[];
    };

export interface LoopGuardOptions {
  /** Fix attempts allowed before the guard trips (Project-Raw: 3). */
  maxAttempts?: number;
  /** Wall-clock cap for the whole task (Project-Raw default: 45 minutes). */
  wallClockMs?: number;
  now?: () => number;
}

/**
 * Loop guards for one task: at most `maxAttempts` failed fix attempts, an immediate stop when the same test fails with
 * the same error twice in a row, and a wall-clock cap. Once tripped it stays tripped; the evidence lists every attempt.
 */
export class LoopGuard {
  private readonly maxAttempts: number;
  private readonly wallClockMs: number;
  private readonly now: () => number;
  private readonly startedAt: number;
  private readonly attempts: Evidence[] = [];
  private last: Failure | null = null;
  private result: GuardResult = { tripped: false };

  constructor(options: LoopGuardOptions = {}) {
    this.maxAttempts = options.maxAttempts ?? 3;
    this.wallClockMs = options.wallClockMs ?? 45 * 60_000;
    this.now = options.now ?? Date.now;
    this.startedAt = this.now();
  }

  private trip(reason: 'max_attempts' | 'same_error_twice' | 'timeout'): GuardResult {
    this.result = { tripped: true, reason, evidence: [...this.attempts] };
    return this.result;
  }

  checkTimeout(): GuardResult {
    if (this.result.tripped) return this.result;
    return this.now() - this.startedAt >= this.wallClockMs ? this.trip('timeout') : this.result;
  }

  recordFailure(failure: Failure): GuardResult {
    if (this.result.tripped) return this.result;
    if (this.checkTimeout().tripped) return this.result;

    this.attempts.push({ attempt: this.attempts.length + 1, ...failure });
    const repeated =
      this.last !== null && this.last.test === failure.test && this.last.error === failure.error;
    this.last = failure;
    if (repeated) return this.trip('same_error_twice');
    if (this.attempts.length >= this.maxAttempts) return this.trip('max_attempts');
    return this.result;
  }

  /** A passing run ends the failure streak; the attempt budget stays spent. */
  recordSuccess(): void {
    this.last = null;
  }
}
