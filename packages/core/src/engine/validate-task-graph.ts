// Client-side mirror of public.create_task_graph (supabase/schemas/22_task_graph.sql): same rules, same messages.
// engine/fixtures/task-graph.json is shared with the database integration test so the two cannot drift apart.

export class TaskGraphError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TaskGraphError';
  }
}

const MAX_TASKS = 500;
const KEY_PATTERN = /^[a-z0-9_-]{1,64}$/;
const TASK_TYPES = ['agent', 'gate', 'system'];
const GATE_KINDS = [
  'spec',
  'plan',
  'milestone_review',
  'release',
  'checklist',
  'budget',
  'usage_extension',
  'secret_request',
  'escalation',
  'other',
];

type Spec = Record<string, unknown>;
const isObject = (v: unknown): v is Spec =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const text = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);
const present = (spec: Spec, field: string) =>
  field in spec && spec[field] !== null && spec[field] !== undefined;

/** Validates a task graph spec and returns the task keys in topological order. Throws TaskGraphError. */
export function validateTaskGraph(spec: unknown): string[] {
  if (!Array.isArray(spec)) throw new TaskGraphError('tasks must be a json array');
  if (spec.length > MAX_TASKS) throw new TaskGraphError(`too many tasks (max ${MAX_TASKS})`);

  const keys: string[] = [];
  const deps = new Map<string, string[]>();

  for (const raw of spec as unknown[]) {
    const task: Spec = isObject(raw) ? raw : {};
    const key = text(task.key);
    if (key === undefined || !KEY_PATTERN.test(key))
      throw new TaskGraphError(`invalid task key: ${key ?? '<null>'}`);
    if (keys.includes(key)) throw new TaskGraphError(`duplicate task key: ${key}`);

    const type = text(task.type);
    if (type === undefined || !TASK_TYPES.includes(type))
      throw new TaskGraphError(`invalid task type: ${type ?? '<null>'} (${key})`);
    if ((text(task.title) ?? '') === '') throw new TaskGraphError(`task needs a title: ${key}`);

    if (type === 'agent' && (text(task.role) ?? '') === '')
      throw new TaskGraphError(`agent task needs a role: ${key}`);
    if (type !== 'agent' && present(task, 'role'))
      throw new TaskGraphError(`role not allowed on ${type} task: ${key}`);

    const gate = task.gate;
    if (type === 'gate' && !isObject(gate))
      throw new TaskGraphError(`gate task needs a gate spec: ${key}`);
    if (type !== 'gate' && present(task, 'gate'))
      throw new TaskGraphError(`gate spec on a non-gate task: ${key}`);
    if (type === 'gate' && isObject(gate) && !GATE_KINDS.includes(text(gate.kind) ?? '')) {
      throw new TaskGraphError(`invalid gate kind: ${text(gate.kind) ?? '<null>'} (${key})`);
    }

    const dependsOn = 'depends_on' in task ? task.depends_on : [];
    if (!Array.isArray(dependsOn)) throw new TaskGraphError(`depends_on must be an array: ${key}`);

    keys.push(key);
    deps.set(key, (dependsOn as unknown[]).map(String));
  }

  for (const key of keys) {
    for (const dep of deps.get(key)!) {
      if (!keys.includes(dep)) throw new TaskGraphError(`unknown dependency: ${key} -> ${dep}`);
    }
  }

  // Kahn in rounds (listing order inside a round), as in the SQL function.
  const order: string[] = [];
  let remaining = keys;
  for (;;) {
    const next = remaining.filter((k) => deps.get(k)!.every((d) => order.includes(d)));
    if (next.length === 0) break;
    order.push(...next);
    remaining = remaining.filter((k) => !next.includes(k));
  }

  if (remaining.length > 0) {
    let current = remaining[0]!;
    const path = [current];
    for (;;) {
      const dep = deps.get(current)!.find((d) => remaining.includes(d))!;
      const seen = path.indexOf(dep);
      if (seen !== -1)
        throw new TaskGraphError(`dependency cycle: ${[...path.slice(seen), dep].join(' -> ')}`);
      path.push(dep);
      current = dep;
    }
  }
  return order;
}
