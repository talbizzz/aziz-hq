import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHandler, type HandlerStore } from './handler.ts';

const SECRET = 's3cret-token';
const OWNER = 4242;
const GATE = '0b9c1f2e-7d4a-4e1b-9a33-5f6c8d2e1a77';
const HEX = GATE.replace(/-/g, '');

// mock Telegram Bot API: records calls
let api: Server;
let apiRoot = '';
let calls: { method: string; body: Record<string, unknown> }[] = [];
beforeAll(async () => {
  api = createServer((req, res) => {
    let b = '';
    req.on('data', (c) => (b += c));
    req.on('end', () => {
      calls.push({ method: req.url!.split('/').pop()!, body: b ? JSON.parse(b) : {} });
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ ok: true, result: { message_id: 1 } }));
    });
  });
  await new Promise<void>((r) => api.listen(0, '127.0.0.1', r));
  apiRoot = `http://127.0.0.1:${(api.address() as AddressInfo).port}`;
});
afterAll(() => api.close());

// store with the semantics of decide_gate: the first decision wins
function memStore() {
  const decided = new Map<string, string>();
  const store: HandlerStore = {
    decideGate: vi.fn(async (taskId: string, decision: 'approve' | 'dismiss') => {
      const existing = decided.get(taskId);
      if (existing) return { first: false, decision: existing };
      decided.set(taskId, decision);
      return { first: true, decision };
    }),
    setOverride: vi.fn(async () => undefined),
    setMode: vi.fn(async () => undefined),
    clearOverride: vi.fn(async () => 1),
    status: vi.fn(async () => ({
      workerOnline: true,
      workerLastSeenMinutes: 1,
      activeRuns: 2,
      openGates: 3,
      overrides: [],
    })),
  };
  return { store, decided };
}

let logs: string[];
beforeEach(() => {
  calls = [];
  logs = [];
});
const hook = (store: HandlerStore, over: { ownerChatId?: number } = {}) =>
  createHandler({
    token: '123:TEST',
    secret: SECRET,
    ownerChatId: over.ownerChatId ?? OWNER,
    store,
    apiRoot,
    log: (m) => logs.push(m),
  });

const cb = (data: string, from = OWNER, chat = OWNER, id = 1) => ({
  update_id: id,
  callback_query: {
    id: `cq${id}`,
    chat_instance: 'x',
    from: { id: from, is_bot: false, first_name: 'A' },
    data,
    message: {
      message_id: 7,
      date: 0,
      chat: { id: chat, type: 'private' },
      text: 'Gate\nApprove the plan\nBuild X · plan',
    },
  },
});
const msg = (text: string, from = OWNER, chat = OWNER, id = 3) => ({
  update_id: id,
  message: {
    message_id: 1,
    date: 0,
    chat: { id: chat, type: 'private' },
    from: { id: from, is_bot: false, first_name: 'A' },
    text,
    entities: text.startsWith('/')
      ? [{ type: 'bot_command', offset: 0, length: text.split(' ')[0]!.length }]
      : undefined,
  },
});
const post = (h: (r: Request) => Promise<Response>, body: unknown, secret?: string) =>
  h(
    new Request('https://x/telegram', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(secret === undefined ? {} : { 'x-telegram-bot-api-secret-token': secret }),
      },
      body: JSON.stringify(body),
    }),
  );
const methods = () => calls.map((c) => c.method);

describe('webhook security (ported from spike S4)', () => {
  it('rejects a missing secret header: 401, no side effect', async () => {
    const { store } = memStore();
    const res = await post(hook(store).handle, cb(`g:${HEX}:a`));
    expect(res.status).toBe(401);
    expect(store.decideGate).not.toHaveBeenCalled();
    expect(calls).toHaveLength(0);
  });
  it('rejects a wrong secret: 401, no side effect', async () => {
    const { store } = memStore();
    const res = await post(hook(store).handle, cb(`g:${HEX}:a`), 'nope');
    expect(res.status).toBe(401);
    expect(store.decideGate).not.toHaveBeenCalled();
  });
  it('ignores a different user/chat: 200, no decision, no Telegram call, logged', async () => {
    const { store } = memStore();
    const res = await post(hook(store).handle, cb(`g:${HEX}:a`, 999, 999), SECRET);
    expect(res.status).toBe(200);
    expect(store.decideGate).not.toHaveBeenCalled();
    expect(calls).toHaveLength(0);
    expect(logs.some((l) => l.includes('ignored') && l.includes('999'))).toBe(true);
  });
  it('ignores the right user in a different chat (e.g. a group)', async () => {
    const { store } = memStore();
    await post(hook(store).handle, cb(`g:${HEX}:a`, OWNER, -100), SECRET);
    expect(store.decideGate).not.toHaveBeenCalled();
  });
  it('ignores unparseable callback data', async () => {
    const { store } = memStore();
    expect((await post(hook(store).handle, cb('garbage'), SECRET)).status).toBe(200);
    expect(store.decideGate).not.toHaveBeenCalled();
  });
  it('ignores commands from a foreign chat', async () => {
    const { store } = memStore();
    await post(hook(store).handle, msg('/pause 30', 999, 999), SECRET);
    expect(store.setOverride).not.toHaveBeenCalled();
    expect(calls).toHaveLength(0);
  });
  it('fails closed when the owner chat id is not a positive integer: ignores everything and logs loudly', async () => {
    for (const bad of [0, Number.NaN, -5, 1.5]) {
      const { store } = memStore();
      logs = [];
      const h = hook(store, { ownerChatId: bad });
      expect(logs.some((l) => l.includes('invalid owner chat id'))).toBe(true);
      const res = await post(h.handle, cb(`g:${HEX}:a`, bad, bad), SECRET);
      expect(res.status).toBe(200);
      expect(store.decideGate).not.toHaveBeenCalled();
    }
  });
});

describe('decisions', () => {
  it('records approve through the store, answers the callback and edits the message', async () => {
    const { store } = memStore();
    expect((await post(hook(store).handle, cb(`g:${HEX}:a`), SECRET)).status).toBe(200);
    expect(store.decideGate).toHaveBeenCalledWith(GATE, 'approve', 'telegram');
    expect(methods()).toEqual(expect.arrayContaining(['answerCallbackQuery', 'editMessageText']));
    expect(calls.find((c) => c.method === 'answerCallbackQuery')!.body.text).toBe(
      'Recorded: approve',
    );
    const edit = calls.find((c) => c.method === 'editMessageText')!.body;
    expect(edit.text).toContain('✅ Approved');
    expect(edit.reply_markup).toEqual({ inline_keyboard: [] });
  });
  it('records dismiss', async () => {
    const { store } = memStore();
    await post(hook(store).handle, cb(`g:${HEX}:d`), SECRET);
    expect(store.decideGate).toHaveBeenCalledWith(GATE, 'dismiss', 'telegram');
    expect(calls.find((c) => c.method === 'editMessageText')!.body.text).toContain('🚫 Dismissed');
  });
  it('is idempotent: a second press, a different button and a Telegram retry keep the first decision', async () => {
    const { store, decided } = memStore();
    const h = hook(store).handle;
    await post(h, cb(`g:${HEX}:a`, OWNER, OWNER, 1), SECRET);
    await post(h, cb(`g:${HEX}:d`, OWNER, OWNER, 2), SECRET);
    await post(h, cb(`g:${HEX}:a`, OWNER, OWNER, 1), SECRET);
    expect(decided.get(GATE)).toBe('approve');
    const answers = calls.filter((c) => c.method === 'answerCallbackQuery').map((c) => c.body.text);
    expect(answers).toEqual([
      'Recorded: approve',
      'Already decided: approve',
      'Already decided: approve',
    ]);
  });
  it('tells the owner when the gate is no longer open', async () => {
    const { store } = memStore();
    (store.decideGate as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error('gate is not open'),
    );
    await post(hook(store).handle, cb(`g:${HEX}:a`), SECRET);
    expect(calls.find((c) => c.method === 'answerCallbackQuery')!.body.text).toBe(
      'Gate is no longer open',
    );
  });
  it('does not decide on the modify button: it points to the dashboard', async () => {
    const { store } = memStore();
    await post(hook(store).handle, cb(`g:${HEX}:m`), SECRET);
    expect(store.decideGate).not.toHaveBeenCalled();
    expect(calls.find((c) => c.method === 'answerCallbackQuery')!.body.text).toMatch(/dashboard/i);
  });
});

describe('commands (owner only)', () => {
  const reply = () => calls.find((c) => c.method === 'sendMessage')!.body.text as string;

  it('/status reports worker, runs, gates and overrides', async () => {
    const { store } = memStore();
    (store.status as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      workerOnline: false,
      workerLastSeenMinutes: 12,
      activeRuns: 1,
      openGates: 4,
      overrides: [{ kind: 'pause', expiresAt: '2026-11-05T15:00:00Z' }],
    });
    await post(hook(store).handle, msg('/status'), SECRET);
    expect(reply()).toMatch(/offline/i);
    expect(reply()).toContain('12');
    expect(reply()).toMatch(/4 open gates?/);
    expect(reply()).toMatch(/pause/i);
  });
  it('/pause sets a pause override with the parsed duration', async () => {
    const { store } = memStore();
    await post(hook(store).handle, msg('/pause 90m'), SECRET);
    expect(store.setOverride).toHaveBeenCalledWith('pause', 90, 'telegram');
    expect(reply()).toMatch(/paused/i);
  });
  it('/pause with a default duration, and a bad one is refused without calling the store', async () => {
    const { store } = memStore();
    await post(hook(store).handle, msg('/pause'), SECRET);
    expect(store.setOverride).toHaveBeenCalledWith('pause', 60, 'telegram');
    calls = [];
    await post(hook(store).handle, msg('/pause 25h'), SECRET);
    expect(store.setOverride).toHaveBeenCalledTimes(1);
    expect(reply()).toMatch(/1 minute/);
  });
  it('/resume, /off and /on call the matching override functions', async () => {
    const { store } = memStore();
    const h = hook(store).handle;
    await post(h, msg('/resume', OWNER, OWNER, 10), SECRET);
    expect(store.clearOverride).toHaveBeenCalledWith('pause');
    await post(h, msg('/off', OWNER, OWNER, 11), SECRET);
    expect(store.setOverride).toHaveBeenCalledWith('off_today', null, 'telegram');
    await post(h, msg('/on', OWNER, OWNER, 12), SECRET);
    expect(store.clearOverride).toHaveBeenCalledWith('off_today');
  });
  it('/help, /start and plain text answer with the command list', async () => {
    const { store } = memStore();
    const h = hook(store).handle;
    for (const [i, text] of ['/help', '/start', 'hello there'].entries()) {
      calls = [];
      await post(h, msg(text, OWNER, OWNER, 20 + i), SECRET);
      expect(reply()).toContain('/status');
      expect(reply()).toContain('/pause');
    }
  });
  it('reports a store failure instead of crashing', async () => {
    const { store } = memStore();
    (store.setOverride as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('db down'));
    const res = await post(hook(store).handle, msg('/pause 10'), SECRET);
    expect(res.status).toBe(200);
    expect(reply()).toMatch(/failed/i);
  });
});

describe('usage mode commands (owner only)', () => {
  const reply = () => calls.find((c) => c.method === 'sendMessage')!.body.text as string;

  it.each([
    ['/working', 'working', null, null, /working/i],
    ['/stop', 'stop', null, null, /stopp?ed/i],
    ['/sleeping', 'sleeping', null, null, /sleeping/i],
  ] as const)('%s sets the %s mode through the store', async (text, kind, minutes, cap, answer) => {
    const { store } = memStore();
    await post(hook(store).handle, msg(text), SECRET);
    expect(store.setMode).toHaveBeenCalledWith(kind, minutes, cap, 'telegram');
    expect(reply()).toMatch(answer);
  });

  it('/custom passes the cap and the duration', async () => {
    const { store } = memStore();
    await post(hook(store).handle, msg('/custom 70 2h'), SECRET);
    expect(store.setMode).toHaveBeenCalledWith('custom', 120, 70, 'telegram');
    expect(reply()).toMatch(/70%/);
  });

  it('/custom with bad arguments explains the usage and calls nothing', async () => {
    const { store } = memStore();
    await post(hook(store).handle, msg('/custom 200 2h'), SECRET);
    expect(store.setMode).not.toHaveBeenCalled();
    expect(reply()).toContain('/custom');
  });

  it('/resume also ends a stop mode', async () => {
    const { store } = memStore();
    await post(hook(store).handle, msg('/resume'), SECRET);
    expect(store.clearOverride).toHaveBeenCalledWith('pause');
    expect(store.clearOverride).toHaveBeenCalledWith('stop');
  });

  it('modes are ignored from a foreign chat', async () => {
    const { store } = memStore();
    await post(hook(store).handle, msg('/stop', 999, 999), SECRET);
    expect(store.setMode).not.toHaveBeenCalled();
  });

  it('/help lists the new commands', async () => {
    const { store } = memStore();
    await post(hook(store).handle, msg('/help'), SECRET);
    for (const c of ['/working', '/stop', '/sleeping', '/custom']) expect(reply()).toContain(c);
  });
});
