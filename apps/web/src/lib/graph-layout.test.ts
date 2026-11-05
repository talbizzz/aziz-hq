import { describe, expect, it } from 'vitest';
import { NODE_HEIGHT, NODE_WIDTH, layoutGraph, type LayoutTask } from './graph-layout.js';

const t = (
  id: string,
  depends_on: string[] = [],
  created_at = '2026-01-01T00:00:00Z',
): LayoutTask => ({ id, depends_on, created_at });
const node = (layout: ReturnType<typeof layoutGraph>, id: string) =>
  layout.nodes.find((n) => n.id === id)!;

describe('layoutGraph', () => {
  it('lays a diamond out in three columns', () => {
    const layout = layoutGraph([t('a'), t('b', ['a']), t('c', ['a']), t('d', ['b', 'c'])]);
    expect(layout.nodes.map((n) => [n.id, n.depth])).toEqual([
      ['a', 0],
      ['b', 1],
      ['c', 1],
      ['d', 2],
    ]);
    expect(node(layout, 'a').x).toBe(0);
    expect(node(layout, 'b').x).toBe(240);
    expect(node(layout, 'd').x).toBe(480);
    expect(layout.edges).toHaveLength(4);
    expect(layout.edges).toContainEqual({ from: 'a', to: 'b' });
    expect(layout.edges).toContainEqual({ from: 'c', to: 'd' });
  });

  it('puts a chain in consecutive columns on one row', () => {
    const layout = layoutGraph([t('a'), t('b', ['a']), t('c', ['b'])]);
    expect(layout.nodes.map((n) => n.depth)).toEqual([0, 1, 2]);
    expect(new Set(layout.nodes.map((n) => n.y)).size).toBe(1);
  });

  it('uses the longest path for depth', () => {
    const layout = layoutGraph([t('a'), t('b', ['a']), t('c', ['a', 'b'])]);
    expect(node(layout, 'c').depth).toBe(2);
  });

  it('stacks tasks of the same depth ordered by created_at, then id, and is independent of input order', () => {
    const tasks = [
      t('z', [], '2026-01-01T00:00:03Z'),
      t('m', [], '2026-01-01T00:00:01Z'),
      t('a', [], '2026-01-01T00:00:01Z'),
    ];
    const layout = layoutGraph(tasks);
    expect(layout.nodes.filter((n) => n.depth === 0).map((n) => n.id)).toEqual(['a', 'm', 'z']);
    expect(layoutGraph([...tasks].reverse()).nodes).toEqual(layout.nodes);
    expect(layout.nodes.map((n) => n.y)).toEqual([0, 88, 176]);
  });

  it('never overlaps nodes and reports a size that contains them all', () => {
    const tasks = [
      t('a'),
      t('b'),
      t('c', ['a']),
      t('d', ['a']),
      t('e', ['b', 'c']),
      t('f', ['d', 'e']),
    ];
    const layout = layoutGraph(tasks);
    expect(new Set(layout.nodes.map((n) => `${n.x},${n.y}`)).size).toBe(tasks.length);
    for (const n of layout.nodes) {
      expect(n.x + NODE_WIDTH).toBeLessThanOrEqual(layout.width);
      expect(n.y + NODE_HEIGHT).toBeLessThanOrEqual(layout.height);
    }
  });

  it('handles an empty graph and ignores unknown dependencies', () => {
    expect(layoutGraph([])).toEqual({ nodes: [], edges: [], width: 0, height: 0 });
    const layout = layoutGraph([t('a', ['ghost'])]);
    expect(layout.nodes).toHaveLength(1);
    expect(layout.edges).toEqual([]);
    expect(node(layout, 'a').depth).toBe(0);
  });
});
