import { describe, expect, it } from 'vitest';
import { FakeRunner } from './fake-runner.js';
import { RunnerRegistry, runnerConfigSchema } from './registry.js';

describe('RunnerRegistry', () => {
  const fake = new FakeRunner();
  const other = {
    name: 'other',
    run: async () => ({ status: 'done' as const, summary: '', costUsd: 0, events: [] }),
  };

  it('resolves the default runner and per-role overrides', () => {
    const registry = new RunnerRegistry().register('fake', fake).register('other', other);
    const config = runnerConfigSchema.parse({ default: 'fake', roles: { reviewer: 'other' } });
    expect(registry.forRole('builder', config)).toBe(fake);
    expect(registry.forRole('reviewer', config)).toBe(other);
  });

  it('throws for an unknown runner name', () => {
    const registry = new RunnerRegistry().register('fake', fake);
    expect(() => registry.forRole('x', runnerConfigSchema.parse({ default: 'api' }))).toThrow(
      'unknown runner: api',
    );
  });

  it('config defaults roles to an empty map and rejects a missing default', () => {
    expect(runnerConfigSchema.parse({ default: 'fake' })).toEqual({ default: 'fake', roles: {} });
    expect(runnerConfigSchema.safeParse({ roles: {} }).success).toBe(false);
  });
});
