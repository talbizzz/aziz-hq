import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { PriorityBadge } from '../components/priority-badge';
import { sortGates, type InboxGate, type SortDir, type SortKey } from '../lib/inbox';
import { fetchDecidedGates, fetchOpenGates } from '../lib/queries';
import { cn } from '../lib/utils';

type Tab = 'open' | 'decided';

function SortHeader({
  label,
  active,
  dir,
  onClick,
}: {
  label: string;
  active: boolean;
  dir: SortDir;
  onClick: () => void;
}) {
  return (
    <th className="py-2 font-medium">
      <button
        type="button"
        onClick={onClick}
        className="inline-flex items-center gap-1 hover:text-foreground"
      >
        {label}
        <span aria-hidden className="text-xs">
          {active ? (dir === 'asc' ? '▲' : '▼') : ''}
        </span>
      </button>
    </th>
  );
}

export function InboxPage() {
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>('open');
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir }>({
    key: 'priority',
    dir: 'desc',
  });
  const gates = useQuery({
    queryKey: ['inbox', 'list', tab],
    queryFn: tab === 'open' ? fetchOpenGates : fetchDecidedGates,
  });

  const rows = useMemo(() => {
    const items = (gates.data ?? []).map((g) => ({
      id: g.task_id,
      title: g.title,
      priority: g.priority,
      openedAt: g.tasks.updated_at,
      runTitle: g.tasks.runs?.title ?? '',
      kind: g.kind,
      decision: g.decision,
    }));
    const byId = new Map(items.map((i) => [i.id, i]));
    const sorted =
      tab === 'open' ? sortGates(items as InboxGate[], sort.key, sort.dir) : (items as InboxGate[]);
    return sorted.map((s) => byId.get(s.id)!);
  }, [gates.data, sort, tab]);

  const toggle = (key: SortKey) =>
    setSort((s) =>
      s.key === key
        ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' }
        : { key, dir: key === 'priority' ? 'desc' : 'asc' },
    );

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-lg font-semibold">Inbox</h1>
      <div role="tablist" className="flex gap-1">
        {(['open', 'decided'] as const).map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className={cn(
              'rounded-md px-3 py-1.5 text-sm',
              tab === t ? 'bg-accent font-medium' : 'text-muted-foreground hover:bg-accent',
            )}
          >
            {t === 'open' ? 'Open' : 'Decided'}
          </button>
        ))}
      </div>

      {gates.isPending && <p className="text-sm text-muted-foreground">Loading gates…</p>}
      {gates.isError && (
        <p role="alert" className="text-sm text-destructive">
          Could not load gates.
        </p>
      )}
      {gates.data && rows.length === 0 && (
        <p className="text-sm text-muted-foreground" data-testid="inbox-table">
          {tab === 'open' ? 'No gates. Nothing waiting for you.' : 'No decided gates yet.'}
        </p>
      )}
      {rows.length > 0 && (
        <table className="w-full text-sm" data-testid="inbox-table">
          <thead className="text-left text-muted-foreground">
            <tr>
              <SortHeader
                label="Priority"
                active={sort.key === 'priority'}
                dir={sort.dir}
                onClick={() => toggle('priority')}
              />
              <th className="font-medium">Gate</th>
              <th className="font-medium">Kind</th>
              <SortHeader
                label="Run"
                active={sort.key === 'run'}
                dir={sort.dir}
                onClick={() => toggle('run')}
              />
              <SortHeader
                label={tab === 'open' ? 'Waiting since' : 'Decided'}
                active={sort.key === 'age'}
                dir={sort.dir}
                onClick={() => toggle('age')}
              />
            </tr>
          </thead>
          <tbody>
            {rows.map((g) => (
              <tr
                key={g.id}
                className="cursor-pointer border-t hover:bg-accent"
                data-testid="gate-row"
                onClick={() => navigate(`/gates/${g.id}`)}
              >
                <td className="py-2">
                  <PriorityBadge priority={g.priority} />
                </td>
                <td className="font-medium">{g.title}</td>
                <td>{g.kind}</td>
                <td>{g.runTitle}</td>
                <td className="text-muted-foreground">
                  {new Date(g.openedAt).toLocaleString()}
                  {g.decision ? ` · ${g.decision}` : ''}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
