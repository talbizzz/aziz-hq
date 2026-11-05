import { describe, expect, it } from 'vitest';
import { fakeRunSpec } from './fake-run.js';
import { validateTaskGraph } from './validate-task-graph.js';

describe('fakeRunSpec', () => {
  it('is a valid graph with parallel tasks, a retried task and a gate', () => {
    const spec = fakeRunSpec();
    const order = validateTaskGraph(spec);
    const keys = spec.map((t) => t.key);
    expect(keys).toEqual(
      expect.arrayContaining(['setup', 'build-a', 'build-b', 'review-gate', 'ship']),
    );
    expect(order.indexOf('setup')).toBeLessThan(order.indexOf('build-a'));
    expect(spec.find((t) => t.key === 'review-gate')?.type).toBe('gate');
    const buildB = spec.find((t) => t.key === 'build-b')!;
    expect(buildB.payload).toMatchObject({
      fake: { outcomes: [{ status: 'failed' }, { status: 'done' }] },
    });
  });

  it('only includes the crash task when asked, and ship then waits for it', () => {
    expect(fakeRunSpec().some((t) => t.key === 'crash-me')).toBe(false);
    const crash = fakeRunSpec({ crash: true });
    expect(validateTaskGraph(crash)).toContain('crash-me');
    expect(crash.find((t) => t.key === 'ship')?.depends_on).toEqual(
      expect.arrayContaining(['review-gate', 'crash-me']),
    );
    expect(crash.find((t) => t.key === 'crash-me')?.payload).toMatchObject({
      fake: { outcomes: [{ hang: true }, { status: 'done' }] },
    });
  });
});
