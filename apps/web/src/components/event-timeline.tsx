import type { Database } from '@aziz-hq/core';

type EventRow = Database['public']['Tables']['events']['Row'];

function describe(e: EventRow): string {
  const data = (e.data ?? {}) as Record<string, unknown>;
  const change =
    data.from !== undefined && data.to !== undefined
      ? ` ${String(data.from)} → ${String(data.to)}`
      : '';
  const reason = typeof data.reason === 'string' ? ` (${data.reason})` : '';
  return `${e.kind}${change}${reason}`;
}

export function EventTimeline({
  events,
  titles,
}: {
  events: EventRow[];
  titles: Map<string, string>;
}) {
  return (
    <section className="rounded-lg border" aria-label="Event timeline">
      <h2 className="border-b px-4 py-2 text-sm font-semibold">Timeline</h2>
      <ul className="max-h-96 divide-y overflow-auto text-sm" data-testid="event-timeline">
        {events.map((e) => (
          <li key={e.id} className="flex flex-col gap-0.5 px-4 py-2" data-testid="event-item">
            <span>
              {describe(e)}
              {e.task_id && titles.get(e.task_id) ? (
                <span className="text-muted-foreground"> · {titles.get(e.task_id)}</span>
              ) : null}
            </span>
            <span className="text-xs text-muted-foreground">
              {new Date(e.at).toLocaleTimeString()} · {e.actor_type}
              {e.actor_id ? `/${e.actor_id}` : ''}
            </span>
          </li>
        ))}
        {events.length === 0 && <li className="px-4 py-3 text-muted-foreground">No events yet.</li>}
      </ul>
    </section>
  );
}
