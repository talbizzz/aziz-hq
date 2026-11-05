import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { EventTimeline } from '../components/event-timeline';
import { StatusBadge } from '../components/status-badge';
import { TaskGraph } from '../components/task-graph';
import { TaskPanel } from '../components/task-panel';
import { WorkerStatus } from '../components/worker-status';
import { layoutGraph } from '../lib/graph-layout';
import { fetchEvents, fetchRun, fetchTasks } from '../lib/queries';
import { useRealtimeInvalidation } from '../lib/realtime';

const TABLES = ['runs', 'tasks', 'events'] as const;

export function RunDetailPage() {
  const { runId = '' } = useParams();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  useRealtimeInvalidation(TABLES, ['runs', 'detail', runId]);

  const run = useQuery({
    queryKey: ['runs', 'detail', runId, 'run'],
    queryFn: () => fetchRun(runId),
  });
  const tasks = useQuery({
    queryKey: ['runs', 'detail', runId, 'tasks'],
    queryFn: () => fetchTasks(runId),
  });
  const events = useQuery({
    queryKey: ['runs', 'detail', runId, 'events'],
    queryFn: () => fetchEvents(runId),
  });

  const layout = useMemo(() => layoutGraph(tasks.data ?? []), [tasks.data]);
  const titles = useMemo(
    () => new Map((tasks.data ?? []).map((t) => [t.id, t.title])),
    [tasks.data],
  );

  if (run.isPending || tasks.isPending)
    return <p className="text-sm text-muted-foreground">Loading run…</p>;
  if (run.isError || tasks.isError)
    return (
      <p role="alert" className="text-sm text-destructive">
        Could not load the run.
      </p>
    );
  if (!run.data)
    return (
      <p className="text-sm">
        Run not found.{' '}
        <Link to="/runs" className="underline">
          Back to runs
        </Link>
      </p>
    );

  const selected = tasks.data.find((t) => t.id === selectedId) ?? null;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-3">
          <Link to="/runs" className="text-sm text-muted-foreground underline">
            Runs
          </Link>
          <h1 className="text-lg font-semibold">{run.data.title}</h1>
          <StatusBadge status={run.data.status} />
        </div>
        <WorkerStatus />
      </div>
      <div className="overflow-auto rounded-lg border p-4">
        <TaskGraph
          tasks={tasks.data}
          layout={layout}
          selectedId={selectedId}
          onSelect={setSelectedId}
        />
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <TaskPanel task={selected} />
        <EventTimeline events={events.data ?? []} titles={titles} />
      </div>
    </div>
  );
}
