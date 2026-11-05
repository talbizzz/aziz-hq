import { createEngine, type Database } from '@aziz-hq/core';
import { createClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  MockTelegram,
  SECRETS,
  localSupabase,
  setVaultSecrets,
  startFunction,
  type RunningFunction,
} from './e2e-support.ts';

const OWNER = 4242;
const local = localSupabase();
const db = createClient<Database>(local.url, local.secretKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const engine = createEngine(db);
const mock = new MockTelegram();
let fn: RunningFunction;

beforeAll(async () => {
  setVaultSecrets();
  await mock.start();
  fn = await startFunction(mock);
});
afterAll(() => {
  fn?.stop();
  mock.stop();
});
beforeEach(async () => {
  mock.reset();
  await db.from('runs').delete().not('id', 'is', null);
  await db.from('notifications').delete().not('id', 'is', null);
  await db.from('overrides').delete().not('id', 'is', null);
  await db.from('worker_heartbeats').delete().not('worker_id', 'is', null);
  await db.from('settings').delete().in('key', ['last_digest_date', 'worker_alert']);
});

const flush = (headers: Record<string, string> = {}) =>
  fetch(`${fn.url}/flush`, {
    method: 'POST',
    headers: { 'x-flush-secret': SECRETS.flush, ...headers },
  });
const webhook = (update: unknown, secret: string | null = SECRETS.webhook) =>
  fetch(fn.url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(secret ? { 'x-telegram-bot-api-secret-token': secret } : {}),
    },
    body: JSON.stringify(update),
  });
const press = (
  taskId: string,
  letter: 'a' | 'd' | 'm',
  over: { from?: number; chat?: number; id?: number } = {},
) => ({
  update_id: over.id ?? 1,
  callback_query: {
    id: `cq${over.id ?? 1}`,
    chat_instance: 'x',
    from: { id: over.from ?? OWNER, is_bot: false, first_name: 'A' },
    data: `g:${taskId.replace(/-/g, '')}:${letter}`,
    message: {
      message_id: 7,
      date: 0,
      chat: { id: over.chat ?? OWNER, type: 'private' },
      text: 'Gate\nApprove\nRun · plan',
    },
  },
});
const command = (text: string, over: { from?: number; chat?: number; id?: number } = {}) => ({
  update_id: over.id ?? 50,
  message: {
    message_id: 1,
    date: 0,
    chat: { id: over.chat ?? OWNER, type: 'private' },
    from: { id: over.from ?? OWNER, is_bot: false, first_name: 'A' },
    text,
    entities: [{ type: 'bot_command', offset: 0, length: text.split(' ')[0]!.length }],
  },
});

async function gateRun(
  gate: Record<string, unknown> = { kind: 'plan', title: 'Approve the plan', priority: 1 },
) {
  const { runId, tasks } = await engine.createRun({
    moduleId: 'factory',
    title: 'e2e run',
    tasks: [
      { key: 'gate', type: 'gate', title: 'gate', gate: gate as never },
      { key: 'after', type: 'system', title: 'after', depends_on: ['gate'] },
    ],
  });
  await engine.schedulerTick(); // opens the gate, which enqueues the notification
  return { runId, gateId: tasks.gate!, afterId: tasks.after! };
}
const notification = async (gateId: string) =>
  (await db.from('notifications').select('*').eq('gate_task_id', gateId).single()).data!;

describe('the telegram Edge Function against the local stack', () => {
  it('flush sends an opened simple gate with inline buttons and records the message id', async () => {
    const { gateId } = await gateRun();
    const res = await flush();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ sent: 1, deferred: 0, failed: 0 });
    const sent = mock.of('sendMessage');
    expect(sent).toHaveLength(1);
    expect(sent[0]!.body.chat_id).toBe(OWNER);
    expect(sent[0]!.body.text).toContain('Approve the plan');
    expect(
      sent[0]!.body.reply_markup.inline_keyboard[0].map(
        (b: { callback_data: string }) => b.callback_data,
      ),
    ).toEqual([`g:${gateId.replace(/-/g, '')}:a`, `g:${gateId.replace(/-/g, '')}:d`]);
    const n = await notification(gateId);
    expect(n.status).toBe('sent');
    expect(n.telegram_message_id).toBe(500);
    // a second flush has nothing left to send
    mock.reset();
    await flush();
    expect(mock.of('sendMessage')).toHaveLength(0);
  });

  it('a button press decides the gate, the run continues, and a second press is idempotent', async () => {
    const { gateId, afterId } = await gateRun();
    await flush();
    mock.reset();

    expect((await webhook(press(gateId, 'a'))).status).toBe(200);
    const gate = (
      await db.from('gates').select('decision, decided_via').eq('task_id', gateId).single()
    ).data!;
    expect(gate).toEqual({ decision: 'approve', decided_via: 'telegram' });
    expect((await db.from('tasks').select('status').eq('id', gateId).single()).data!.status).toBe(
      'done',
    );
    expect(mock.of('answerCallbackQuery')[0]!.body.text).toBe('Recorded: approve');
    expect(mock.of('editMessageText')[0]!.body.text).toContain('✅ Approved');
    expect(mock.of('editMessageText')[0]!.body.reply_markup).toEqual({ inline_keyboard: [] });

    // the run continues: the task behind the gate is now claimable
    expect((await engine.claimTask('e2e'))?.id).toBe(afterId);

    // pressing again, even the other button, changes nothing
    mock.reset();
    expect((await webhook(press(gateId, 'd', { id: 2 }))).status).toBe(200);
    expect(mock.of('answerCallbackQuery')[0]!.body.text).toBe('Already decided: approve');
    expect(
      (await db.from('gates').select('decision').eq('task_id', gateId).single()).data!.decision,
    ).toBe('approve');
    const events = (
      await db.from('events').select('id').eq('task_id', gateId).eq('kind', 'gate_decided')
    ).data!;
    expect(events).toHaveLength(1);
  });

  it('rejects calls without or with a wrong secret and ignores foreign chats', async () => {
    const { gateId } = await gateRun();
    expect((await webhook(press(gateId, 'a'), null)).status).toBe(401);
    expect((await webhook(press(gateId, 'a'), 'wrong')).status).toBe(401);
    expect((await flush({ 'x-flush-secret': 'wrong' })).status).toBe(401);
    expect((await fetch(`${fn.url}/flush`, { method: 'POST' })).status).toBe(401);
    expect((await fetch(fn.url)).status).toBe(405);

    expect((await webhook(press(gateId, 'a', { from: 999, chat: 999 }))).status).toBe(200); // the foreign user
    expect((await webhook(press(gateId, 'a', { from: OWNER, chat: -100 }))).status).toBe(200); // the owner in a group
    expect((await webhook(command('/pause 30', { from: 999, chat: 999 }))).status).toBe(200);
    expect(
      (await db.from('gates').select('decision').eq('task_id', gateId).single()).data!.decision,
    ).toBeNull();
    expect(mock.calls).toHaveLength(0);
    expect((await db.from('overrides').select('id')).data).toHaveLength(0);
  });

  it('a complex gate only links to the dashboard', async () => {
    const { gateId } = await gateRun({
      kind: 'plan',
      title: 'Needs a comment',
      priority: 1,
      options: [
        { id: 'm', label: 'Modify', kind: 'modify' },
        { id: 'a', label: 'Approve', kind: 'approve' },
      ],
    });
    await flush();
    const markup = mock.of('sendMessage')[0]!.body.reply_markup;
    expect(markup.inline_keyboard).toEqual([
      [{ text: 'Open in dashboard', url: `${SECRETS.dashboard}/gates/${gateId}` }],
    ]);
  });

  it('defers normal gates in quiet hours and when off today, but always sends critical ones', async () => {
    const normal = await gateRun();
    const night = { 'x-test-now': '2026-11-05T22:30:00Z' }; // 23:30 in Berlin
    expect(await (await flush(night)).json()).toMatchObject({ sent: 0, deferred: 1 });
    expect(mock.of('sendMessage')).toHaveLength(0);
    const n = await notification(normal.gateId);
    expect(n.status).toBe('pending');
    expect(new Date(n.deliver_after).toISOString()).toBe('2026-11-06T06:00:00.000Z'); // 07:00 Berlin

    await db.from('runs').delete().not('id', 'is', null);
    await db.from('notifications').delete().not('id', 'is', null);
    const critical = await gateRun({ kind: 'plan', title: 'Blocking!', priority: 2 });
    expect(await (await flush(night)).json()).toMatchObject({ sent: 1 });
    expect(mock.of('sendMessage')[0]!.body.text).toContain('Blocking gate');
    expect((await notification(critical.gateId)).status).toBe('sent');

    // off today defers a normal gate at noon
    mock.reset();
    await db.from('runs').delete().not('id', 'is', null);
    await db.from('notifications').delete().not('id', 'is', null);
    await db.rpc('set_override', { p_kind: 'off_today', p_via: 'telegram' });
    const other = await gateRun();
    expect(await (await flush({ 'x-test-now': '2026-11-05T11:00:00Z' })).json()).toMatchObject({
      sent: 0,
      deferred: 1,
    });
    expect((await notification(other.gateId)).status).toBe('pending');
  });

  it('batches info notifications into one daily digest, once per day', async () => {
    const { tasks } = await engine.createRun({
      moduleId: 'factory',
      title: 'finished run',
      tasks: [{ key: 't', type: 'system', title: 't' }],
    });
    const claimed = await engine.claimTask('digest-worker');
    await engine.completeTask(claimed!.id, 'digest-worker', {});
    await engine.schedulerTick(); // the run settles as done and enqueues an info notification
    expect(tasks.t).toBeTruthy();

    expect(await (await flush({ 'x-test-now': '2026-11-05T06:00:00Z' })).json()).toMatchObject({
      digestSent: false,
    }); // 07:00 Berlin: before 08:00
    expect(mock.of('sendMessage')).toHaveLength(0);

    const due = { 'x-test-now': '2026-11-05T08:30:00Z' }; // 09:30 Berlin
    expect(await (await flush(due)).json()).toMatchObject({ digestSent: true });
    expect(mock.of('sendMessage')).toHaveLength(1);
    expect(mock.of('sendMessage')[0]!.body.text).toContain('Daily digest');
    expect(mock.of('sendMessage')[0]!.body.text).toContain('finished run');
    expect(
      (await db.from('settings').select('value').eq('key', 'last_digest_date').single()).data!
        .value,
    ).toBe('2026-11-05');

    mock.reset();
    expect(await (await flush(due)).json()).toMatchObject({ digestSent: false }); // already sent today
    expect(mock.of('sendMessage')).toHaveLength(0);
  });

  it('retries a failed Telegram send with backoff and never sends twice', async () => {
    const { gateId } = await gateRun();
    mock.failNext = 1;
    expect(await (await flush()).json()).toMatchObject({ sent: 0, failed: 1 });
    const n = await notification(gateId);
    expect(n).toMatchObject({ status: 'pending', attempts: 1 });
    expect(n.error).toContain('sendMessage failed');
    expect(new Date(n.deliver_after).getTime()).toBeGreaterThan(Date.now() + 30_000); // backs off ~1 minute
    mock.reset();
    await flush(); // not due yet
    expect(mock.of('sendMessage')).toHaveLength(0);
  });

  it('chat commands: /pause stops claiming, /resume restarts it, /status reports', async () => {
    await engine.createRun({
      moduleId: 'factory',
      title: 'cmd run',
      tasks: [{ key: 't', type: 'system', title: 't' }],
    });
    expect((await webhook(command('/pause 30'))).status).toBe(200);
    expect(mock.of('sendMessage')[0]!.body.text).toMatch(/Paused for 30 min/);
    expect(await engine.claimTask('w')).toBeNull();

    mock.reset();
    await webhook(command('/status', { id: 51 }));
    const status = mock.of('sendMessage')[0]!.body.text as string;
    expect(status).toMatch(/pause/i);
    expect(status).toMatch(/1 active runs?/);

    mock.reset();
    await webhook(command('/resume', { id: 52 }));
    expect(mock.of('sendMessage')[0]!.body.text).toMatch(/Resumed/);
    expect((await engine.claimTask('w'))?.title).toBe('t');

    mock.reset();
    await webhook(command('/pause 99h', { id: 53 }));
    expect(mock.of('sendMessage')[0]!.body.text).toMatch(/between 1 minute and 24 hours/);
  });
});
