export const NODE_WIDTH = 180;
export const NODE_HEIGHT = 56;
const COLUMN = 240;
const ROW = 88;

export interface LayoutTask {
  id: string;
  depends_on: string[];
  created_at: string;
}

export interface LayoutNode {
  id: string;
  depth: number;
  x: number;
  y: number;
}

export interface Layout {
  nodes: LayoutNode[];
  edges: { from: string; to: string }[];
  width: number;
  height: number;
}

/** Layered layout: column = longest dependency path, row = order by created_at then id within the column. */
export function layoutGraph(tasks: LayoutTask[]): Layout {
  if (tasks.length === 0) return { nodes: [], edges: [], width: 0, height: 0 };

  const byId = new Map(tasks.map((t) => [t.id, t]));
  const depthOf = new Map<string, number>();
  const visiting = new Set<string>();
  const depth = (id: string): number => {
    const known = depthOf.get(id);
    if (known !== undefined) return known;
    if (visiting.has(id)) return 0; // cycles cannot exist (ADR-13); never recurse forever
    visiting.add(id);
    const deps = byId.get(id)!.depends_on.filter((d) => byId.has(d));
    const d = deps.length === 0 ? 0 : 1 + Math.max(...deps.map(depth));
    visiting.delete(id);
    depthOf.set(id, d);
    return d;
  };

  const ordered = [...tasks].sort(
    (a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id),
  );
  const rowsInColumn = new Map<number, number>();
  const nodes: LayoutNode[] = ordered.map((t) => {
    const d = depth(t.id);
    const row = rowsInColumn.get(d) ?? 0;
    rowsInColumn.set(d, row + 1);
    return { id: t.id, depth: d, x: d * COLUMN, y: row * ROW };
  });
  nodes.sort((a, b) => a.depth - b.depth || a.y - b.y);

  const edges = tasks.flatMap((t) =>
    t.depends_on.filter((d) => byId.has(d)).map((d) => ({ from: d, to: t.id })),
  );
  const maxDepth = Math.max(...nodes.map((n) => n.depth));
  const maxRows = Math.max(...rowsInColumn.values());
  return {
    nodes,
    edges,
    width: maxDepth * COLUMN + NODE_WIDTH,
    height: maxRows * ROW - (ROW - NODE_HEIGHT),
  };
}
