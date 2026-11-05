import type { Task } from '@aziz-hq/core';
import { StatusBadge } from './status-badge';

export function TaskPanel({ task }: { task: Task | null }) {
  return (
    <section className="rounded-lg border p-4" data-testid="task-panel">
      {!task ? (
        <p className="text-sm text-muted-foreground">Select a task to see its details.</p>
      ) : (
        <div className="flex flex-col gap-2 text-sm">
          <div className="flex items-center justify-between gap-2">
            <h2 className="font-semibold">{task.title}</h2>
            <StatusBadge status={task.status} />
          </div>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-muted-foreground">
            <dt>Role</dt>
            <dd className="text-foreground">{task.role ?? task.type}</dd>
            <dt>Attempts</dt>
            <dd className="text-foreground">
              {task.attempts} / {task.max_attempts}
            </dd>
            <dt>Claimed by</dt>
            <dd className="text-foreground">{task.claimed_by ?? '—'}</dd>
          </dl>
          {task.result && (
            <pre className="max-h-48 overflow-auto rounded-md bg-muted p-2 text-xs">
              {JSON.stringify(task.result, null, 2)}
            </pre>
          )}
        </div>
      )}
    </section>
  );
}
