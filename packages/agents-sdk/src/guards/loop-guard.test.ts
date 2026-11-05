import { describe, expect, it } from 'vitest';
import { LoopGuard } from './loop-guard.js';

const MIN = 60_000;

describe('LoopGuard', () => {
  it('allows two different failures and trips on the third attempt (max 3 fix attempts)', () => {
    const guard = new LoopGuard({ now: () => 0 });
    expect(guard.recordFailure({ test: 'a', error: 'e1' })).toEqual({ tripped: false });
    expect(guard.recordFailure({ test: 'b', error: 'e2' })).toEqual({ tripped: false });
    const third = guard.recordFailure({ test: 'c', error: 'e3' });
    expect(third).toMatchObject({ tripped: true, reason: 'max_attempts' });
  });

  it('trips immediately when the same test fails with the same error twice in a row', () => {
    const guard = new LoopGuard({ now: () => 0 });
    guard.recordFailure({ test: 'login works', error: 'expected 200 got 500' });
    const second = guard.recordFailure({ test: 'login works', error: 'expected 200 got 500' });
    expect(second).toMatchObject({ tripped: true, reason: 'same_error_twice' });
  });

  it('does not trip when the same test fails with a different error, or a different test with the same error', () => {
    const guard = new LoopGuard({ now: () => 0 });
    guard.recordFailure({ test: 't', error: 'e1' });
    expect(guard.recordFailure({ test: 't', error: 'e2' })).toEqual({ tripped: false });
    const other = new LoopGuard({ now: () => 0 });
    other.recordFailure({ test: 't1', error: 'e' });
    expect(other.recordFailure({ test: 't2', error: 'e' })).toEqual({ tripped: false });
  });

  it('only counts the same failure when it is consecutive', () => {
    const guard = new LoopGuard({ maxAttempts: 10, now: () => 0 });
    guard.recordFailure({ test: 'a', error: 'e' });
    guard.recordFailure({ test: 'b', error: 'x' });
    expect(guard.recordFailure({ test: 'a', error: 'e' })).toEqual({ tripped: false });
  });

  it('trips on the wall-clock cap (default 45 minutes), checked on demand and when recording', () => {
    let now = 1_000;
    const guard = new LoopGuard({ now: () => now });
    expect(guard.checkTimeout()).toEqual({ tripped: false });
    now += 44 * MIN;
    expect(guard.checkTimeout()).toEqual({ tripped: false });
    now += 1 * MIN;
    expect(guard.checkTimeout()).toMatchObject({ tripped: true, reason: 'timeout' });
    expect(guard.recordFailure({ test: 't', error: 'e' })).toMatchObject({
      tripped: true,
      reason: 'timeout',
    });
  });

  it('carries the evidence: every attempt with its test and error', () => {
    const guard = new LoopGuard({ now: () => 0 });
    guard.recordFailure({ test: 'a', error: 'e1' });
    guard.recordFailure({ test: 'b', error: 'e2' });
    const result = guard.recordFailure({ test: 'c', error: 'e3' });
    expect(result.tripped && result.evidence).toEqual([
      { attempt: 1, test: 'a', error: 'e1' },
      { attempt: 2, test: 'b', error: 'e2' },
      { attempt: 3, test: 'c', error: 'e3' },
    ]);
  });

  it('stays tripped once tripped, and honours custom limits', () => {
    const guard = new LoopGuard({ maxAttempts: 1, now: () => 0 });
    expect(guard.recordFailure({ test: 'a', error: 'e' })).toMatchObject({
      tripped: true,
      reason: 'max_attempts',
    });
    expect(guard.recordFailure({ test: 'z', error: 'other' })).toMatchObject({ tripped: true });
  });

  it('a success resets the failure streak but not the attempt budget', () => {
    const guard = new LoopGuard({ now: () => 0 });
    guard.recordFailure({ test: 'a', error: 'e' });
    guard.recordSuccess();
    expect(guard.recordFailure({ test: 'a', error: 'e' })).toEqual({ tripped: false }); // not "twice in a row" any more
    expect(guard.recordFailure({ test: 'x', error: 'y' })).toMatchObject({
      tripped: true,
      reason: 'max_attempts',
    }); // 3 attempts used overall
  });
});
