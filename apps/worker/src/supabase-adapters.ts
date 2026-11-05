import type { Task, TaskSpec, PolicyOverride, UsageSnapshot } from '@aziz-hq/core';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { RunRecorder, WorkerEngine } from './engine.js';
import type { PolicyDb } from './policy-source.js';

type Db = SupabaseClient;

const check = <T>(r: { data: T | null; error: { message: string } | null }, what: string): T => {
  if (r.error) throw new Error(`${what}: ${r.error.message}`);
  return r.data as T;
};

/** Reads the usage policy inputs (latest snapshot, active overrides, settings) with the service client. */
export function createPolicyDb(db: Db): PolicyDb {
  return {
    async latestSnapshot() {
      const rows = check(
        await db.from('usage_snapshots').select('*').order('at', { ascending: false }).limit(1),
        'usage_snapshots',
      ) as Record<string, unknown>[];
      const r = rows[0];
      if (!r) return null;
      return {
        fiveHourPct: Number(r.five_hour_pct),
        fiveHourResetsAt: new Date(String(r.five_hour_resets_at)),
        sevenDayPct: Number(r.seven_day_pct),
        sevenDayResetsAt: new Date(String(r.seven_day_resets_at)),
      } satisfies UsageSnapshot;
    },

    async activeOverrides() {
      const rows = check(
        await db.from('active_overrides').select('kind, cap_pct, created_at, expires_at'),
        'active_overrides',
      ) as Record<string, unknown>[];
      return rows.map(
        (r) =>
          ({
            kind: r.kind as PolicyOverride['kind'],
            capPct: r.cap_pct === null ? null : Number(r.cap_pct),
            createdAt: new Date(String(r.created_at)),
            expiresAt: new Date(String(r.expires_at)),
          }) satisfies PolicyOverride,
      );
    },

    async settings() {
      const rows = check(
        await db.from('settings').select('key, value').in('key', ['usage_policy', 'timezone']),
        'settings',
      ) as { key: string; value: unknown }[];
      const get = (k: string) => rows.find((r) => r.key === k)?.value;
      return { usagePolicy: get('usage_policy'), timezone: get('timezone') };
    },
  };
}

export interface TranscriptSink {
  save(entry: { runId: string; taskId: string; attempt: number; text: string }): Promise<void>;
}

/** The blocking escalation gate opened when a task fails for good (milestone 4, C5). */
export function escalationGate(task: Task, evidence: Record<string, unknown>): TaskSpec {
  const title = `Task failed: ${task.title}`;
  return {
    key: `escalation-${task.id.slice(0, 8)}`,
    type: 'gate',
    title,
    gate: {
      kind: 'escalation',
      title,
      priority: 2,
      context: { task: { id: task.id, title: task.title, role: task.role }, ...evidence },
      options: [
        { id: 'acknowledge', label: 'Acknowledge', kind: 'approve' },
        { id: 'dismiss', label: 'Dismiss', kind: 'dismiss' },
      ],
    },
  };
}

export function createRunRecorder(deps: {
  db: Db;
  engine: Pick<WorkerEngine, 'createTaskGraph'>;
  transcripts?: TranscriptSink;
}): RunRecorder {
  const { db, engine, transcripts } = deps;
  return {
    async usage(task, runner, u) {
      const { error } = await db.from('usage').insert({
        run_id: task.run_id,
        task_id: task.id,
        role: task.role,
        model: u.model,
        runner,
        input_tokens: u.inputTokens,
        output_tokens: u.outputTokens,
        cache_read_tokens: u.cacheReadTokens,
        cache_write_tokens: u.cacheWriteTokens,
        cost_usd: u.costUsd,
      });
      if (error) throw new Error(error.message);
    },

    async transcript(task, text) {
      await transcripts?.save({
        runId: task.run_id,
        taskId: task.id,
        attempt: task.attempts,
        text,
      });
    },

    async escalate(task, evidence) {
      await engine.createTaskGraph(task.run_id, [escalationGate(task, evidence)]);
    },
  };
}
