import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTelegramApi } from './telegram-api.ts';

let server: Server;
let root = '';
let requests: { url: string; body: Record<string, unknown> }[] = [];
let reply: { status: number; json: unknown } = {
  status: 200,
  json: { ok: true, result: { message_id: 77 } },
};

beforeAll(async () => {
  server = createServer((req, res) => {
    let b = '';
    req.on('data', (c) => (b += c));
    req.on('end', () => {
      requests.push({ url: req.url!, body: JSON.parse(b || '{}') });
      res.statusCode = reply.status;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify(reply.json));
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  root = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => server.close());
beforeEach(() => {
  requests = [];
  reply = { status: 200, json: { ok: true, result: { message_id: 77 } } };
});

describe('createTelegramApi', () => {
  it('sends an HTML message and returns the message id', async () => {
    const api = createTelegramApi({ token: '123:ABC', apiRoot: root });
    const id = await api.sendMessage(4242, 'hello <b>x</b>', {
      inline_keyboard: [[{ text: 'Go', url: 'https://x.test' }]],
    });
    expect(id).toBe(77);
    expect(requests[0]!.url).toBe('/bot123:ABC/sendMessage');
    expect(requests[0]!.body).toEqual({
      chat_id: 4242,
      text: 'hello <b>x</b>',
      parse_mode: 'HTML',
      reply_markup: { inline_keyboard: [[{ text: 'Go', url: 'https://x.test' }]] },
    });
  });
  it('omits reply_markup when there is none', async () => {
    await createTelegramApi({ token: 't', apiRoot: root }).sendMessage(1, 'x');
    expect(requests[0]!.body).not.toHaveProperty('reply_markup');
  });
  it('throws with the Bot API description on an error response, never including the token', async () => {
    reply = { status: 400, json: { ok: false, description: 'Bad Request: chat not found' } };
    const err = await createTelegramApi({ token: '123:SECRETTOKEN', apiRoot: root })
      .sendMessage(1, 'x')
      .catch((e: Error) => e);
    expect((err as Error).message).toContain('chat not found');
    expect((err as Error).message).not.toContain('SECRETTOKEN');
  });
});
