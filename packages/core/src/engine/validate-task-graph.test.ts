import { describe, expect, it } from 'vitest';
import fixtures from './fixtures/task-graph.json' with { type: 'json' };
import { TaskGraphError, validateTaskGraph } from './validate-task-graph.js';

describe('validateTaskGraph: shared fixtures (the SQL create_task_graph must agree)', () => {
  it.each(fixtures.valid)('accepts: $name', ({ spec }) => {
    const order = validateTaskGraph(spec);
    expect(order).toHaveLength(Array.isArray(spec) ? spec.length : 0);
  });

  it.each(fixtures.invalid)('rejects: $name', ({ spec, error }) => {
    expect(() => validateTaskGraph(spec)).toThrowError(new TaskGraphError(error));
  });

  it('rejects more than 500 tasks and accepts exactly 500', () => {
    const make = (n: number) =>
      Array.from({ length: n }, (_, i) => ({ key: `k${i}`, type: 'system', title: 't' }));
    expect(() => validateTaskGraph(make(501))).toThrowError('too many tasks (max 500)');
    expect(validateTaskGraph(make(500))).toHaveLength(500);
  });

  it('returns a topological order that respects every dependency', () => {
    const order = validateTaskGraph(fixtures.valid[1]!.spec);
    expect(order.indexOf('a')).toBeLessThan(order.indexOf('b'));
    expect(order.indexOf('a')).toBeLessThan(order.indexOf('c'));
    expect(order.indexOf('b')).toBeLessThan(order.indexOf('d'));
    expect(order.indexOf('c')).toBeLessThan(order.indexOf('d'));
  });
});

// Small seeded PRNG so failures are reproducible.
const rng = (seed: number) => () => {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
};

describe('validateTaskGraph: random graphs', () => {
  it('accepts random DAGs in any listing order and orders them topologically', () => {
    for (let seed = 1; seed <= 200; seed++) {
      const rand = rng(seed);
      const n = 2 + Math.floor(rand() * 25);
      const tasks = Array.from({ length: n }, (_, i) => ({
        key: `k${i}`,
        type: 'system',
        title: `t${i}`,
        depends_on: Array.from({ length: i }, (_, j) => `k${j}`).filter(() => rand() < 0.3),
      }));
      const shuffled = [...tasks].sort(() => rand() - 0.5);
      const order = validateTaskGraph(shuffled);
      expect(order, `seed ${seed}`).toHaveLength(n);
      for (const t of tasks)
        for (const d of t.depends_on)
          expect(order.indexOf(d), `seed ${seed}`).toBeLessThan(order.indexOf(t.key));
    }
  });

  it('rejects random graphs containing a cycle and reports a real cycle', () => {
    for (let seed = 1; seed <= 200; seed++) {
      const rand = rng(seed * 7919);
      const n = 2 + Math.floor(rand() * 20);
      // a chain k0 <- k1 <- ... <- k(n-1), plus random extra edges, plus k0 depending on the last one
      const deps: Record<string, string[]> = {};
      for (let i = 0; i < n; i++) deps[`k${i}`] = i === 0 ? [`k${n - 1}`] : [`k${i - 1}`];
      for (let i = 1; i < n; i++)
        if (rand() < 0.3) deps[`k${i}`]!.push(`k${Math.floor(rand() * i)}`);
      const spec = Object.entries(deps).map(([key, depends_on]) => ({
        key,
        type: 'system',
        title: key,
        depends_on,
      }));

      let message = '';
      try {
        validateTaskGraph(spec);
      } catch (e) {
        message = (e as Error).message;
      }
      expect(message, `seed ${seed}`).toMatch(/^dependency cycle: /);
      const path = message.replace('dependency cycle: ', '').split(' -> ');
      expect(path[0], `seed ${seed}`).toBe(path[path.length - 1]);
      for (let i = 0; i < path.length - 1; i++)
        expect(deps[path[i]!], `seed ${seed}`).toContain(path[i + 1]);
    }
  });
});
