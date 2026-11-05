export interface InboxGate {
  id: string;
  title: string;
  priority: number;
  /** When the gate started waiting for a human. */
  openedAt: string;
  runTitle: string;
}

export type SortKey = 'priority' | 'age' | 'run';
export type SortDir = 'asc' | 'desc';

const byAge = (a: InboxGate, b: InboxGate) =>
  a.openedAt.localeCompare(b.openedAt) || a.id.localeCompare(b.id);

/** Default view: `sortGates(g, 'priority', 'desc')` = blocking first, oldest first within a priority. */
export function sortGates(gates: InboxGate[], key: SortKey, dir: SortDir): InboxGate[] {
  const sign = dir === 'asc' ? 1 : -1;
  const compare = {
    priority: (a: InboxGate, b: InboxGate) => sign * (a.priority - b.priority) || byAge(a, b),
    age: (a: InboxGate, b: InboxGate) => sign * byAge(a, b),
    run: (a: InboxGate, b: InboxGate) => sign * a.runTitle.localeCompare(b.runTitle) || byAge(a, b),
  }[key];
  return [...gates].sort(compare);
}
