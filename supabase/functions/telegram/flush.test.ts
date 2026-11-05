import { describe, expect, it, vi } from 'vitest';
import { processFlush, type FlushStore, type NotificationRow, type TelegramApi } from './flush.js';

const TASK = '0b9c1f2e-7d4a-4e1b-9a33-5f6c8d2e1a77';
const row = (over: Partial<NotificationRow> = {}): NotificationRow => ({
  id: 'n1',
  kind: 'gate_open',
  priority: 1,
  gate_task_id: TASK,
  run_id: 'r1',
  created_at: '2026-11-05T11:00:00Z',
  payload: { title: 'Approve the plan', gate_kind: 'plan', run_title: 'Build X', simple: true },
  ...over,
});

function setup(
  rows: NotificationRow[],
  over: Partial<{
    now: string;
    offToday: boolean;
    lastDigestDate: string | null;
    offlineAlertSent: boolean;
    sendFails: boolean;
  }> = {},
) {
  const store = {
    due: vi.fn(async () => rows),
    mark: vi.fn(async () => undefined),
    settings: vi.fn(async () => ({
      timezone: 'Europe/Berlin',
      quietHours: { start: '22:00', end: '07:00' },
      digestTime: '08:00',
      lastDigestDate: over.lastDigestDate ?? null,
      offToday: over.offToday ?? false,
    })),
    setLastDigestDate: vi.fn(async () => undefined),
    offlineAlertSent: vi.fn(async () => over.offlineAlertSent ?? true),
  } satisfies FlushStore;
  let nextId = 100;
  const api = {
    sendMessage: vi.fn<TelegramApi['sendMessage']>(async () => {
      if (over.sendFails) throw new Error('telegram 500');
      return nextId++;
    }),
  } satisfies TelegramApi;
  const run = () =>
    processFlush({
      store,
      api,
      chatId: 4242,
      dashboardUrl: 'https://hq.example.test',
      now: () => new Date(over.now ?? '2026-11-05T12:00:00Z'),
      log: () => {},
    });
  return { store, api, run };
}

describe('processFlush', () => {
  it('sends a simple gate with buttons and marks it sent with the message id', async () => {
    const { store, api, run } = setup([row()]);
    const summary = await run();
    expect(api.sendMessage).toHaveBeenCalledOnce();
    const [chat, text, markup] = api.sendMessage.mock.calls[0]!;
    expect(chat).toBe(4242);
    expect(text).toContain('Approve the plan');
    expect(JSON.stringify(markup)).toContain('callback_data');
    expect(store.mark).toHaveBeenCalledWith('n1', { status: 'sent', messageId: 100 });
    expect(summary).toMatchObject({ sent: 1, deferred: 0, skipped: 0, failed: 0 });
  });

  it('sends a complex gate with a dashboard link only', async () => {
    const { api, run } = setup([
      row({ payload: { title: 'T', gate_kind: 'plan', run_title: 'R', simple: false } }),
    ]);
    await run();
    const markup = JSON.stringify(api.sendMessage.mock.calls[0]![2]);
    expect(markup).toContain(`https://hq.example.test/gates/${TASK}`);
    expect(markup).not.toContain('callback_data');
  });

  it('defers a normal notification in quiet hours and sends a critical one at once', async () => {
    const { store, api, run } = setup(
      [
        row({ id: 'normal' }),
        row({ id: 'critical', priority: 2, gate_task_id: '1b9c1f2e-7d4a-4e1b-9a33-5f6c8d2e1a77' }),
      ],
      { now: '2026-11-05T22:30:00Z' },
    );
    const summary = await run();
    expect(store.mark).toHaveBeenCalledWith('normal', {
      status: 'deferred',
      deferUntil: new Date('2026-11-06T06:00:00Z'),
    });
    expect(store.mark).toHaveBeenCalledWith('critical', { status: 'sent', messageId: 100 });
    expect(api.sendMessage).toHaveBeenCalledOnce();
    expect(summary).toMatchObject({ sent: 1, deferred: 1 });
  });

  it('defers normal notifications when off today', async () => {
    const { store, run } = setup([row()], { offToday: true });
    await run();
    expect(store.mark).toHaveBeenCalledWith('n1', {
      status: 'deferred',
      deferUntil: new Date('2026-11-06T06:00:00Z'),
    });
  });

  it('keeps info notifications pending until the digest is due, then sends one digest', async () => {
    const info = [
      row({
        id: 'i1',
        kind: 'run_done',
        priority: 0,
        gate_task_id: null,
        payload: { title: 'Run A' },
      }),
      row({
        id: 'i2',
        kind: 'run_failed',
        priority: 0,
        gate_task_id: null,
        payload: { title: 'Run B' },
      }),
    ];
    const before = setup(info, { now: '2026-11-05T06:00:00Z' }); // 07:00 local, before 08:00
    expect((await before.run()).digestSent).toBe(false);
    expect(before.api.sendMessage).not.toHaveBeenCalled();
    expect(before.store.mark).not.toHaveBeenCalled();

    const due = setup(info, { now: '2026-11-05T07:30:00Z' }); // 08:30 local
    const summary = await due.run();
    expect(summary.digestSent).toBe(true);
    expect(due.api.sendMessage).toHaveBeenCalledOnce();
    expect(due.api.sendMessage.mock.calls[0]![1]).toContain('Daily digest');
    expect(due.store.mark).toHaveBeenCalledWith('i1', { status: 'sent', messageId: 100 });
    expect(due.store.mark).toHaveBeenCalledWith('i2', { status: 'sent', messageId: 100 });
    expect(due.store.setLastDigestDate).toHaveBeenCalledWith('2026-11-05');

    const again = setup(info, { now: '2026-11-05T09:00:00Z', lastDigestDate: '2026-11-05' });
    expect((await again.run()).digestSent).toBe(false);
    expect(again.api.sendMessage).not.toHaveBeenCalled();
  });

  it('an empty digest sends nothing but records the day', async () => {
    const { store, api, run } = setup([], { now: '2026-11-05T07:30:00Z' });
    expect((await run()).digestSent).toBe(false);
    expect(api.sendMessage).not.toHaveBeenCalled();
    expect(store.setLastDigestDate).toHaveBeenCalledWith('2026-11-05');
  });

  it('marks a failed send as failed with the error and does not send twice', async () => {
    const { store, api, run } = setup([row()], { sendFails: true });
    const summary = await run();
    expect(api.sendMessage).toHaveBeenCalledOnce();
    expect(store.mark).toHaveBeenCalledWith('n1', { status: 'failed', error: 'telegram 500' });
    expect(summary).toMatchObject({ sent: 0, failed: 1 });
  });

  it('skips worker_online when no offline alert was sent', async () => {
    const { store, api, run } = setup(
      [row({ kind: 'worker_online', priority: 2, gate_task_id: null, payload: {} })],
      { offlineAlertSent: false },
    );
    const summary = await run();
    expect(api.sendMessage).not.toHaveBeenCalled();
    expect(store.mark).toHaveBeenCalledWith('n1', { status: 'skipped' });
    expect(summary.skipped).toBe(1);
  });

  it('sends worker alerts as plain text', async () => {
    const { api, run } = setup([
      row({
        kind: 'worker_offline',
        priority: 2,
        gate_task_id: null,
        payload: { age_seconds: 600 },
      }),
    ]);
    await run();
    expect(api.sendMessage.mock.calls[0]![1]).toMatch(/Worker offline/);
  });
});
