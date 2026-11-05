import { describe, expect, it } from 'vitest';
import { isWorkerOnline } from './worker-status.js';

const now = new Date('2026-01-01T12:00:00Z');

describe('isWorkerOnline', () => {
  it('is online when the last heartbeat is under two minutes old', () => {
    expect(isWorkerOnline('2026-01-01T11:59:00Z', now)).toBe(true);
    expect(isWorkerOnline('2026-01-01T11:58:01Z', now)).toBe(true);
  });
  it('is offline when stale, missing or unparseable', () => {
    expect(isWorkerOnline('2026-01-01T11:58:00Z', now)).toBe(false);
    expect(isWorkerOnline(null, now)).toBe(false);
    expect(isWorkerOnline('garbage', now)).toBe(false);
  });
});
