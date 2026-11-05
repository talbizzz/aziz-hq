import { describe, expect, it } from 'vitest';
import { sortGates, type InboxGate } from './inbox.js';

const g = (id: string, priority: number, openedAt: string, run = 'run'): InboxGate => ({
  id,
  priority,
  openedAt,
  runTitle: run,
  title: id,
});
const ids = (gates: InboxGate[]) => gates.map((x) => x.id);

describe('sortGates', () => {
  const gates = [
    g('normal-new', 1, '2026-01-02T00:00:00Z', 'b'),
    g('blocking', 2, '2026-01-03T00:00:00Z', 'c'),
    g('info', 0, '2026-01-01T00:00:00Z', 'a'),
    g('normal-old', 1, '2026-01-01T00:00:00Z', 'b'),
  ];

  it('defaults to priority (blocking first), oldest first within a priority', () => {
    expect(ids(sortGates(gates, 'priority', 'desc'))).toEqual([
      'blocking',
      'normal-old',
      'normal-new',
      'info',
    ]);
  });
  it('reverses the order', () => {
    expect(ids(sortGates(gates, 'priority', 'asc'))).toEqual([
      'info',
      'normal-old',
      'normal-new',
      'blocking',
    ]);
  });
  it('sorts by age (oldest first by default) and by run title', () => {
    expect(ids(sortGates(gates, 'age', 'asc'))).toEqual([
      'info',
      'normal-old',
      'normal-new',
      'blocking',
    ]);
    expect(ids(sortGates(gates, 'age', 'desc'))).toEqual([
      'blocking',
      'normal-new',
      'normal-old',
      'info',
    ]);
    expect(ids(sortGates(gates, 'run', 'asc'))).toEqual([
      'info',
      'normal-old',
      'normal-new',
      'blocking',
    ]);
  });
  it('does not mutate its input', () => {
    const copy = [...gates];
    sortGates(gates, 'priority', 'desc');
    expect(gates).toEqual(copy);
  });
});
