import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { StatusBadge } from '../components/status-badge';
import { fetchRuns } from '../lib/queries';
import { useRealtimeInvalidation } from '../lib/realtime';

const TABLES = ['runs', 'tasks'] as const;
const KEY = ['runs', 'list'] as const;

export function RunsPage() {
  const navigate = useNavigate();
  useRealtimeInvalidation(TABLES, KEY);
  const { data: runs, isPending, isError } = useQuery({ queryKey: KEY, queryFn: fetchRuns });

  if (isPending) return <p className="text-sm text-muted-foreground">Loading runs…</p>;
  if (isError)
    return (
      <p role="alert" className="text-sm text-destructive">
        Could not load runs.
      </p>
    );

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-lg font-semibold">Runs</h1>
      {runs.length === 0 ? (
        <p className="text-sm text-muted-foreground" data-testid="runs-list">
          No runs yet.
        </p>
      ) : (
        <table className="w-full text-sm" data-testid="runs-list">
          <thead className="text-left text-muted-foreground">
            <tr>
              <th className="py-2 font-medium">Run</th>
              <th className="font-medium">Module</th>
              <th className="font-medium">Status</th>
              <th className="font-medium">Tasks</th>
              <th className="font-medium">Updated</th>
            </tr>
          </thead>
          <tbody>
            {runs.map((run) => {
              const done = run.tasks.filter((t) => t.status === 'done').length;
              return (
                <tr
                  key={run.id}
                  className="cursor-pointer border-t hover:bg-accent"
                  data-testid="run-row"
                  onClick={() => navigate(`/runs/${run.id}`)}
                >
                  <td className="py-2 font-medium">{run.title}</td>
                  <td>{run.module_id}</td>
                  <td>
                    <StatusBadge status={run.status} />
                  </td>
                  <td>
                    {done}/{run.tasks.length}
                  </td>
                  <td className="text-muted-foreground">
                    {new Date(run.updated_at).toLocaleString()}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
