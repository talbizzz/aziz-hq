import type { SupabaseClient } from '@supabase/supabase-js';
import type { FlushSettings, FlushStore, MarkUpdate, NotificationRow } from './flush.ts';
import type { HandlerStore } from './handler.ts';
import type { TelegramConfig } from './server.ts';

type Db = SupabaseClient;

function check<T>(result: { data: T | null; error: { message: string } | null }, what: string): T {
  if (result.error) throw new Error(`${what}: ${result.error.message}`);
  return result.data as T;
}

/** The webhook secrets, read through the service_role-only RPC (they live in Vault). */
export async function loadTelegramConfig(db: Db): Promise<TelegramConfig> {
  return check(await db.rpc('telegram_config'), 'telegram_config') as TelegramConfig;
}

export function createHandlerStore(db: Db): HandlerStore {
  return {
    async decideGate(taskId, decision, via) {
      const out = check(
        await db.rpc('decide_gate', {
          p_task_id: taskId,
          p_decision: decision,
          p_comment: null,
          p_via: via,
        }),
        'decide_gate',
      );
      return out as { first: boolean; decision: string };
    },

    async setOverride(kind, minutes, via) {
      check(
        await db.rpc('set_override', { p_kind: kind, p_minutes: minutes, p_via: via }),
        'set_override',
      );
    },

    async setMode(kind, minutes, capPct, via) {
      check(
        await db.rpc('set_mode_override', {
          p_kind: kind,
          p_minutes: minutes,
          p_cap_pct: capPct,
          p_via: via,
        }),
        'set_mode_override',
      );
    },

    async clearOverride(kind) {
      return check(await db.rpc('clear_override', { p_kind: kind }), 'clear_override') as number;
    },

    async status() {
      const [beat, runs, gates, overrides] = await Promise.all([
        db
          .from('worker_heartbeats')
          .select('last_seen_at')
          .order('last_seen_at', { ascending: false })
          .limit(1),
        db
          .from('runs')
          .select('id', { count: 'exact', head: true })
          .in('status', ['pending', 'running']),
        db
          .from('tasks')
          .select('id', { count: 'exact', head: true })
          .eq('type', 'gate')
          .eq('status', 'waiting_human'),
        db.from('active_overrides').select('kind, expires_at'),
      ]);
      const lastSeen =
        (check(beat, 'worker_heartbeats') as { last_seen_at: string }[])[0]?.last_seen_at ?? null;
      const minutes =
        lastSeen === null
          ? null
          : Math.max(0, Math.round((Date.now() - Date.parse(lastSeen)) / 60_000));
      return {
        workerOnline: minutes !== null && minutes < 2,
        workerLastSeenMinutes: minutes,
        activeRuns: runs.count ?? 0,
        openGates: gates.count ?? 0,
        overrides: (
          check(overrides, 'active_overrides') as { kind: string; expires_at: string }[]
        ).map((o) => ({ kind: o.kind, expiresAt: o.expires_at })),
      };
    },
  };
}

const DEFAULT_SETTINGS: FlushSettings = {
  timezone: 'Europe/Berlin',
  quietHours: { start: '22:00', end: '07:00' },
  digestTime: '08:00',
  lastDigestDate: null,
  offToday: false,
};

export function createFlushStore(db: Db): FlushStore {
  return {
    async due(limit) {
      return check(
        await db.rpc('due_notifications', { p_limit: limit }),
        'due_notifications',
      ) as NotificationRow[];
    },

    async mark(id, update: MarkUpdate) {
      check(
        await db.rpc('mark_notification', {
          p_id: id,
          p_status: update.status,
          p_message_id: 'messageId' in update ? update.messageId : null,
          p_error: 'error' in update ? update.error : null,
          p_defer_until: 'deferUntil' in update ? update.deferUntil.toISOString() : null,
        }),
        'mark_notification',
      );
    },

    async settings() {
      const rows = check(
        await db
          .from('settings')
          .select('key, value')
          .in('key', ['timezone', 'quiet_hours', 'digest_time', 'last_digest_date']),
        'settings',
      ) as { key: string; value: unknown }[];
      const get = (key: string) => rows.find((r) => r.key === key)?.value;
      const off = check(
        await db.from('active_overrides').select('kind').eq('kind', 'off_today'),
        'active_overrides',
      ) as unknown[];
      return {
        timezone: (get('timezone') as string | undefined) ?? DEFAULT_SETTINGS.timezone,
        quietHours:
          (get('quiet_hours') as FlushSettings['quietHours'] | undefined) ??
          DEFAULT_SETTINGS.quietHours,
        digestTime: (get('digest_time') as string | undefined) ?? DEFAULT_SETTINGS.digestTime,
        lastDigestDate: (get('last_digest_date') as string | undefined) ?? null,
        offToday: off.length > 0,
      };
    },

    async setLastDigestDate(date) {
      check(
        await db.from('settings').upsert({ key: 'last_digest_date', value: date }),
        'settings upsert',
      );
    },

    async offlineAlertSent() {
      const rows = check(
        await db
          .from('notifications')
          .select('status')
          .eq('kind', 'worker_offline')
          .order('created_at', { ascending: false })
          .limit(1),
        'notifications',
      ) as { status: string }[];
      return rows[0]?.status === 'sent';
    },
  };
}
