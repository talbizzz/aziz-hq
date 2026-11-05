import { compileDigest, isDigestDue } from './digest.js';
import { gateMessage, escapeHtml, type ReplyMarkup } from './format.js';
import { decideDelivery, type PolicyNotification } from './policy.js';
import { localDate } from './time.js';

export interface NotificationRow {
  id: string;
  kind: PolicyNotification['kind'];
  priority: 0 | 1 | 2;
  gate_task_id: string | null;
  run_id: string | null;
  payload: Record<string, unknown>;
  created_at: string;
}

export interface FlushSettings {
  timezone: string;
  quietHours: { start: string; end: string };
  digestTime: string;
  lastDigestDate: string | null;
  offToday: boolean;
}

export type MarkUpdate =
  | { status: 'sent'; messageId: number }
  | { status: 'skipped' }
  | { status: 'failed'; error: string }
  | { status: 'deferred'; deferUntil: Date };

export interface FlushStore {
  due(limit: number): Promise<NotificationRow[]>;
  mark(id: string, update: MarkUpdate): Promise<void>;
  settings(): Promise<FlushSettings>;
  setLastDigestDate(date: string): Promise<void>;
  offlineAlertSent(): Promise<boolean>;
}

export interface TelegramApi {
  /** Sends an HTML message and returns the Telegram message id. */
  sendMessage(chatId: number, text: string, replyMarkup?: ReplyMarkup): Promise<number>;
}

export interface FlushDeps {
  store: FlushStore;
  api: TelegramApi;
  chatId: number;
  dashboardUrl: string;
  now: () => Date;
  log: (msg: string) => void;
}

export interface FlushSummary {
  sent: number;
  deferred: number;
  skipped: number;
  failed: number;
  digestSent: boolean;
}

function render(
  row: NotificationRow,
  dashboardUrl: string,
): { text: string; replyMarkup?: ReplyMarkup } {
  switch (row.kind) {
    case 'gate_open':
      return gateMessage(row, row.gate_task_id!, dashboardUrl);
    case 'worker_offline': {
      const minutes = Math.round(Number(row.payload.age_seconds ?? 0) / 60);
      return { text: `⚠️ Worker offline: no heartbeat for ${minutes} min.` };
    }
    case 'worker_online':
      return { text: '✅ Worker is back online.' };
    default:
      return { text: escapeHtml(String(row.payload.title ?? row.kind)) };
  }
}

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** One flush: send what the policy allows, defer/skip the rest, and send the daily digest when it is due. */
export async function processFlush(deps: FlushDeps): Promise<FlushSummary> {
  const { store, api, chatId, dashboardUrl, now, log } = deps;
  const summary: FlushSummary = { sent: 0, deferred: 0, skipped: 0, failed: 0, digestSent: false };
  const rows = await store.due(50);
  const settings = await store.settings();
  const offlineAlertSent = await store.offlineAlertSent();
  const digestRows: NotificationRow[] = [];

  for (const row of rows) {
    const decision = decideDelivery(row, {
      now: now(),
      timezone: settings.timezone,
      quietHours: settings.quietHours,
      offToday: settings.offToday,
      offlineAlertSent,
    });
    if (decision.action === 'digest') {
      digestRows.push(row);
    } else if (decision.action === 'defer') {
      await store.mark(row.id, { status: 'deferred', deferUntil: decision.until });
      summary.deferred++;
    } else if (decision.action === 'skip') {
      await store.mark(row.id, { status: 'skipped' });
      summary.skipped++;
    } else {
      try {
        const { text, replyMarkup } = render(row, dashboardUrl);
        const messageId = await api.sendMessage(chatId, text, replyMarkup);
        await store.mark(row.id, { status: 'sent', messageId });
        summary.sent++;
      } catch (e) {
        log(`send failed for ${row.id}: ${errorText(e)}`);
        await store.mark(row.id, { status: 'failed', error: errorText(e) });
        summary.failed++;
      }
    }
  }

  if (
    isDigestDue({
      now: now(),
      timezone: settings.timezone,
      digestTime: settings.digestTime,
      lastDigestDate: settings.lastDigestDate,
    })
  ) {
    const text = compileDigest(digestRows);
    if (text === null) {
      await store.setLastDigestDate(localDate(now(), settings.timezone));
    } else {
      try {
        const messageId = await api.sendMessage(chatId, text);
        for (const row of digestRows) await store.mark(row.id, { status: 'sent', messageId });
        await store.setLastDigestDate(localDate(now(), settings.timezone));
        summary.digestSent = true;
      } catch (e) {
        log(`digest failed: ${errorText(e)}`);
        for (const row of digestRows)
          await store.mark(row.id, { status: 'failed', error: errorText(e) });
        summary.failed += digestRows.length;
      }
    }
  }
  return summary;
}
