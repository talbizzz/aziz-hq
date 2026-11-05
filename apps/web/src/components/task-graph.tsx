import type { Layout } from '../lib/graph-layout';
import { NODE_HEIGHT, NODE_WIDTH } from '../lib/graph-layout';
import { cn } from '../lib/utils';

export interface GraphTask {
  id: string;
  title: string;
  role: string | null;
  type: string;
  status: string;
}

const rectStyles: Record<string, string> = {
  pending: 'fill-card stroke-border',
  running: 'fill-primary/10 stroke-primary',
  waiting_human: 'fill-accent stroke-ring [stroke-dasharray:4_3]',
  done: 'fill-secondary stroke-muted-foreground/50',
  failed: 'fill-destructive/10 stroke-destructive',
  cancelled: 'fill-muted stroke-border opacity-60',
};

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

export function TaskGraph({
  tasks,
  layout,
  selectedId,
  onSelect,
}: {
  tasks: GraphTask[];
  layout: Layout;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const pos = new Map(layout.nodes.map((n) => [n.id, n]));
  return (
    <svg
      width={layout.width + 2}
      height={layout.height + 2}
      className="block"
      data-testid="run-graph"
      role="img"
      aria-label="Task graph"
    >
      <g transform="translate(1 1)">
        {layout.edges.map((e) => {
          const a = pos.get(e.from)!;
          const b = pos.get(e.to)!;
          const x1 = a.x + NODE_WIDTH;
          const y1 = a.y + NODE_HEIGHT / 2;
          const x2 = b.x;
          const y2 = b.y + NODE_HEIGHT / 2;
          const mid = (x1 + x2) / 2;
          return (
            <path
              key={`${e.from}-${e.to}`}
              d={`M${x1} ${y1} C${mid} ${y1} ${mid} ${y2} ${x2} ${y2}`}
              className="fill-none stroke-border"
            />
          );
        })}
        {layout.nodes.map((n) => {
          const t = byId.get(n.id)!;
          return (
            <g
              key={n.id}
              transform={`translate(${n.x} ${n.y})`}
              data-testid={`task-node-${n.id}`}
              data-status={t.status}
              role="button"
              tabIndex={0}
              className="cursor-pointer outline-none"
              onClick={() => onSelect(n.id)}
              onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && onSelect(n.id)}
            >
              <rect
                width={NODE_WIDTH}
                height={NODE_HEIGHT}
                rx={8}
                className={cn(
                  rectStyles[t.status] ?? rectStyles.pending,
                  selectedId === n.id && 'stroke-2 stroke-foreground',
                )}
              />
              <text x={12} y={22} className="fill-foreground text-[13px] font-medium">
                {clip(t.title, 24)}
              </text>
              <text
                x={12}
                y={42}
                className="fill-muted-foreground text-[11px]"
              >{`${t.role ?? t.type} · ${t.status.replace('_', ' ')}`}</text>
            </g>
          );
        })}
      </g>
    </svg>
  );
}
